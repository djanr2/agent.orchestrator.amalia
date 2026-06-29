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

test("flujo completo: crear tarea → claim → reportar completada", async () => {
  const createRes = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({
      assigned_to: "database-bee",
      description: "Tarea de integración",
      priority: "high",
      slug: "integracion",
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

test("GET /tasks sin token devuelve 401", async () => {
  const res = await fetch(`${baseUrl}/tasks`);
  expect(res.status).toBe(401);
});
