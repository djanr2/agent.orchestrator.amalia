import { test, expect, beforeAll, afterAll } from "vitest";
import { openDb, applySchema } from "../src/db/index.js";
import { createServer } from "../src/api/server.js";
import { hashToken, generateToken } from "../src/api/auth.js";

const OP_TOKEN = generateToken();
const BEE_TOKEN = generateToken();
let baseUrl: string;
let server: Awaited<ReturnType<typeof createServer>>;

beforeAll(async () => {
  const db = openDb(":memory:");
  applySchema(db);

  db.prepare(
    `INSERT INTO bees (id, name, worktree_path, engine, connection_mode, token_hash, status)
     VALUES (1, 'amalia', '/wt/op', 'opencode', 'cli', ?, 'idle'),
            (2, 'database-bee', '/wt/db', 'claude-code', 'cli', ?, 'idle')`,
  ).run(hashToken(OP_TOKEN), hashToken(BEE_TOKEN));

  server = createServer({ db, port: 0 });
  await server.listen(0);
  const addr = server.httpServer.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}/api/orchestrator`;
});

afterAll(async () => {
  await server.close();
});

test("full flow: create task → claim → report completed", async () => {
  const createRes = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({
      assigned_to: "database-bee",
      description: "Integration task",
      priority: "high",
      slug: "integration",
      depends_on: [],
      max_attempts: 3,
    }),
  });
  expect(createRes.status).toBe(201);
  const task = await createRes.json();
  expect(task.status).toBe("pending");
  expect(task.code).toMatch(/^TASK-\d+$/);

  const claimRes = await fetch(`${baseUrl}/tasks/${task.code}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEE_TOKEN}` },
    body: JSON.stringify({ instance_id: "test-instance" }),
  });
  expect(claimRes.status).toBe(200);
  const claim = await claimRes.json();
  expect(claim.claimed).toBe(true);

  const resultRes = await fetch(`${baseUrl}/tasks/${task.code}/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEE_TOKEN}` },
    body: JSON.stringify({
      outcome: "completed",
      idempotency_key: "integ-key-1",
      files_changed: ["src/test.ts"],
    }),
  });
  expect(resultRes.status).toBe(200);

  const listRes = await fetch(`${baseUrl}/tasks`, {
    headers: { Authorization: `Bearer ${OP_TOKEN}` },
  });
  expect(listRes.status).toBe(200);
  const tasks = await listRes.json();
  const found = tasks.find((t: any) => t.code === task.code);
  expect(found).toBeDefined();
  expect(found.status).toBe("completed");
});

test("GET /tasks with no token returns 401", async () => {
  const res = await fetch(`${baseUrl}/tasks`);
  expect(res.status).toBe(401);
});

test("double claim returns claimed: false", async () => {
  const res = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({
      assigned_to: "database-bee", description: "Double claim", priority: "low",
      slug: "double-claim", depends_on: [], max_attempts: 3,
    }),
  });
  const task = await res.json();

  const c1 = await fetch(`${baseUrl}/tasks/${task.code}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEE_TOKEN}` },
    body: JSON.stringify({ instance_id: "i1" }),
  });
  expect((await c1.json()).claimed).toBe(true);

  const c2 = await fetch(`${baseUrl}/tasks/${task.code}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEE_TOKEN}` },
    body: JSON.stringify({ instance_id: "i2" }),
  });
  expect((await c2.json()).claimed).toBe(false);
});

test("operator-only routes return 403 for a bee token", async () => {
  const routes = [
    ["POST", "/tasks", { assigned_to: "database-bee", description: "x", priority: "low", slug: "forbid-op", depends_on: [], max_attempts: 3 }],
  ] as const;
  for (const [, path, body] of routes) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEE_TOKEN}` },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(403);
  }
});

test("idempotency: same idempotency_key does not duplicate the result", async () => {
  const res = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({
      assigned_to: "database-bee", description: "Idemp test", priority: "low",
      slug: "idemp-api", depends_on: [], max_attempts: 3,
    }),
  });
  const task = await res.json();

  await fetch(`${baseUrl}/tasks/${task.code}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEE_TOKEN}` },
    body: JSON.stringify({ instance_id: "i-idemp" }),
  });

  const r1 = await fetch(`${baseUrl}/tasks/${task.code}/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEE_TOKEN}` },
    body: JSON.stringify({ outcome: "completed", idempotency_key: "idem-api-1" }),
  });
  const r1b = await r1.json();

  const r2 = await fetch(`${baseUrl}/tasks/${task.code}/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEE_TOKEN}` },
    body: JSON.stringify({ outcome: "completed", idempotency_key: "idem-api-1" }),
  });
  const r2b = await r2.json();

  expect(r1b.result.id).toBe(r2b.result.id);
});

test("failure with exhausted retries propagates to the dependent", async () => {
  const depRes = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({
      assigned_to: "database-bee", description: "Fails", priority: "low",
      slug: "prop-fail", depends_on: [], max_attempts: 1,
    }),
  });
  const dep = await depRes.json();

  const mainRes = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({
      assigned_to: "database-bee", description: "Depends on it", priority: "low",
      slug: "prop-depends", depends_on: [dep.code], max_attempts: 3,
    }),
  });
  const main = await mainRes.json();
  expect(main.status).toBe("blocked");

  await fetch(`${baseUrl}/tasks/${dep.code}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEE_TOKEN}` },
    body: JSON.stringify({ instance_id: "i-prop" }),
  });

  await fetch(`${baseUrl}/tasks/${dep.code}/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEE_TOKEN}` },
    body: JSON.stringify({ outcome: "failed", idempotency_key: "prop-key" }),
  });

  const depCheck = await fetch(`${baseUrl}/tasks/${dep.code}`, {
    headers: { Authorization: `Bearer ${OP_TOKEN}` },
  });
  const depData = await depCheck.json();
  expect(depData.status).toBe("blocked");
  expect(depData.block_reason).toBe("retries_exhausted");

  const mainCheck = await fetch(`${baseUrl}/tasks/${main.code}`, {
    headers: { Authorization: `Bearer ${OP_TOKEN}` },
  });
  const mainData = await mainCheck.json();
  expect(mainData.status).toBe("blocked");
  expect(mainData.block_reason).toBe("upstream_failed");
});

test("PATCH /tasks/:code/status manually changes the status", async () => {
  const res = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({
      assigned_to: "database-bee", description: "Manual status", priority: "low",
      slug: "manual-status", depends_on: [], max_attempts: 3,
    }),
  });
  const task = await res.json();

  const patchRes = await fetch(`${baseUrl}/tasks/${task.code}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({ status: "cancelled" }),
  });
  expect(patchRes.status).toBe(200);
  const updated = await patchRes.json();
  expect(updated.status).toBe("cancelled");
});

test("PATCH /tasks/:code/status with an invalid status returns 400", async () => {
  const res = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({
      assigned_to: "database-bee", description: "Invalid status", priority: "low",
      slug: "invalid-status", depends_on: [], max_attempts: 3,
    }),
  });
  const task = await res.json();

  const patchRes = await fetch(`${baseUrl}/tasks/${task.code}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({ status: "invalid_status" }),
  });
  expect(patchRes.status).toBe(400);
});

test("POST /tasks with a bee token returns 403", async () => {
  const res = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEE_TOKEN}` },
    body: JSON.stringify({
      assigned_to: "database-bee", description: "x", priority: "low",
      slug: "bee-create", depends_on: [], max_attempts: 3,
    }),
  });
  expect(res.status).toBe(403);
});

test("GET /tasks/:code/results returns a task's results", async () => {
  const res = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({
      assigned_to: "database-bee", description: "Results test", priority: "low",
      slug: "results-test", depends_on: [], max_attempts: 3,
    }),
  });
  const task = await res.json();

  await fetch(`${baseUrl}/tasks/${task.code}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEE_TOKEN}` },
    body: JSON.stringify({ instance_id: "res-instance" }),
  });

  await fetch(`${baseUrl}/tasks/${task.code}/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BEE_TOKEN}` },
    body: JSON.stringify({ outcome: "completed", idempotency_key: "res-get-key" }),
  });

  const res2 = await fetch(`${baseUrl}/tasks/${task.code}/results`, {
    headers: { Authorization: `Bearer ${OP_TOKEN}` },
  });
  expect(res2.status).toBe(200);
  const results = await res2.json();
  expect(Array.isArray(results)).toBe(true);
  expect(results.length).toBe(1);
  expect(results[0].idempotency_key).toBe("res-get-key");
});
