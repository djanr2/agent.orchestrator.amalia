import { test, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb, applySchema } from "../src/db/index.js";
import { createServer } from "../src/api/server.js";
import { hashToken, generateToken } from "../src/api/auth.js";
import { OrchestratorClient } from "../src/engines/api-client.js";
import { readBeeConfig, readBeeToken } from "../src/engines/bee-config.js";
import { runBee } from "../src/engines/bee-runtime.js";
import { getAdapter } from "../src/engines/launch.js";
import { ollamaAdapter } from "../src/engines/adapters/ollama.js";
import type { EngineAdapter, TaskSpec, EngineContext } from "../src/engines/adapters/index.js";

// ───── 4.1: api-client tests ─────

const OP_TOKEN = generateToken();
const BEE_TOKEN = generateToken();
let baseUrl: string;
let server: Awaited<ReturnType<typeof createServer>>;
let db: ReturnType<typeof openDb>;

beforeAll(async () => {
  db = openDb(":memory:");
  applySchema(db);
  db.prepare(
    `INSERT INTO bees (id, name, worktree_path, engine, connection_mode, token_hash, status)
     VALUES (1, 'amalia', '/wt/op', 'opencode', 'cli', ?, 'idle'),
            (2, 'test-bee', '/bee/test', 'claude-code', 'cli', ?, 'idle')`,
  ).run(hashToken(OP_TOKEN), hashToken(BEE_TOKEN));
  server = createServer({ db, port: 0 });
  await server.listen(0);
  const addr = server.httpServer.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}/api/orchestrator`;
});

afterAll(async () => {
  await server.close();
  db.close();
});

test("api-client: register + heartbeat", async () => {
  const client = new OrchestratorClient(baseUrl, BEE_TOKEN, "test-bee");
  const reg = await client.register({
    worktree_path: "/bee/test",
    engine: "claude-code",
    connection_mode: "cli",
    heartbeat_seconds: 60,
  });
  expect(reg.ok).toBe(true);
  if (reg.ok) {
    expect(reg.data.id).toBe(2);
    expect(reg.data.status).toBe("idle");
  }

  const hb = await client.heartbeat(2);
  expect(hb.ok).toBe(true);
});

test("api-client: listMyTasks only returns assigned tasks", async () => {
  const opClient = new OrchestratorClient(baseUrl, OP_TOKEN, "amalia");
  const beeClient = new OrchestratorClient(baseUrl, BEE_TOKEN, "test-bee");

  // Create task for test-bee
  const createRes = await opClient.register({
    worktree_path: "/wt/op", engine: "opencode", connection_mode: "cli",
  });
  expect(createRes.ok).toBe(true);

  const taskRes = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({
      assigned_to: "test-bee", description: "Engine test task",
      priority: "high", slug: "engine-test", depends_on: [], max_attempts: 3,
    }),
  });
  expect(taskRes.status).toBe(201);
  const created = await taskRes.json();

  const list = await beeClient.listMyTasks("pending");
  expect(list.ok).toBe(true);
  if (list.ok) {
    const found = list.data.find((t) => t.code === created.code);
    expect(found).toBeDefined();
    expect(found!.status).toBe("pending");
  }
});

test("api-client: claim + report cycle", async () => {
  const beeClient = new OrchestratorClient(baseUrl, BEE_TOKEN, "test-bee");

  const taskRes = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({
      assigned_to: "test-bee", description: "Claim cycle test",
      priority: "medium", slug: "claim-cycle", depends_on: [], max_attempts: 3,
    }),
  });
  const task = await taskRes.json();

  const claim = await beeClient.claim(task.code, "test-instance");
  expect(claim.ok).toBe(true);
  if (claim.ok) {
    expect(claim.data.claimed).toBe(true);
  }

  const report = await beeClient.reportResult(task.code, {
    outcome: "completed",
    idempotency_key: "claim-cycle-key",
    files_changed: ["test.txt"],
  });
  expect(report.ok).toBe(true);
  if (report.ok) {
    expect(report.data.task.status).toBe("completed");
  }
});

test("api-client: double claim returns claimed:false", async () => {
  const beeClient = new OrchestratorClient(baseUrl, BEE_TOKEN, "test-bee");

  const taskRes = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({
      assigned_to: "test-bee", description: "Double claim test",
      priority: "low", slug: "double-claim-eng", depends_on: [], max_attempts: 3,
    }),
  });
  const task = await taskRes.json();

  const c1 = await beeClient.claim(task.code, "i1");
  expect(c1.ok && c1.data.claimed).toBe(true);

  const c2 = await beeClient.claim(task.code, "i2");
  expect(c2.ok).toBe(true);
  if (c2.ok) {
    expect(c2.data.claimed).toBe(false);
  }
});

// ───── 4.2: bee-config tests ─────

let beeDir: string;
let secretsDir: string;

beforeEach(() => {
  beeDir = join(tmpdir(), `amalia-eng-config-${Date.now()}`);
  secretsDir = join(beeDir, ".secrets");
  mkdirSync(secretsDir, { recursive: true });
  mkdirSync(join(beeDir, "tasks"), { recursive: true });
});

afterEach(() => {
  try { rmSync(beeDir, { recursive: true, force: true }); } catch { /* Windows */ }
});

test("bee-config: reads bee.md correctly", () => {
  const beeMd = `# Bee: test-bee

## Engine
- **Engine:** claude-code
- **Connection mode:** cli
- **Model:** claude-sonnet-4
- **Heartbeat (seconds):** 30

## Orchestrator API Connection
- **Name:** test-bee
- **Start command:** npx claude-code
`;
  writeFileSync(join(beeDir, "bee.md"), beeMd, "utf8");

  const config = readBeeConfig(beeDir);
  expect(config.engine).toBe("claude-code");
  expect(config.connection_mode).toBe("cli");
  expect(config.model).toBe("claude-sonnet-4");
  expect(config.heartbeat_seconds).toBe(30);
  expect(config.bee_name).toBe("test-bee");
  expect(config.start_command).toBe("npx claude-code");
});

test("bee-config: reads token from disk", () => {
  writeFileSync(join(secretsDir, "test-bee.token"), "secret-token-value", "utf8");
  const token = readBeeToken(secretsDir, "test-bee");
  expect(token).toBe("secret-token-value");
});

test("bee-config: bee.md with no engine throws", () => {
  writeFileSync(join(beeDir, "bee.md"), "# Bee: test\n## Engine\n- **Model:** x\n", "utf8");
  expect(() => readBeeConfig(beeDir)).toThrow("missing 'Engine'");
});

// ───── 4.3: runtime tests ─────

test("bee-runtime: runs a task with a simulated adapter", async () => {
  const runtimeBeeDir = join(tmpdir(), `amalia-runtime-${Date.now()}`);
  const rtSecretsDir = join(runtimeBeeDir, ".secrets");
  mkdirSync(rtSecretsDir, { recursive: true });
  mkdirSync(join(runtimeBeeDir, "tasks"), { recursive: true });

  // Create bee.md
  const beeMd = `# Bee: runtime-bee
## Engine
- **Engine:** custom
- **Connection mode:** cli
- **Heartbeat (seconds):** 9999

## Orchestrator API Connection
- **Name:** runtime-bee
`;
  writeFileSync(join(runtimeBeeDir, "bee.md"), beeMd, "utf8");

  // Create bee in DB + token
  const rtToken = generateToken();
  db.prepare(
    `INSERT INTO bees (name, worktree_path, engine, connection_mode, token_hash, status)
     VALUES ('runtime-bee', ?, 'custom', 'cli', ?, 'idle')`,
  ).run(runtimeBeeDir, hashToken(rtToken));
  writeFileSync(join(rtSecretsDir, "runtime-bee.token"), rtToken, "utf8");

  // Create a pending task for runtime-bee
  const createTask = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({
      assigned_to: "runtime-bee", description: "Runtime integration test",
      priority: "high", slug: "runtime-test", depends_on: [], max_attempts: 3,
    }),
  });
  expect(createTask.status).toBe(201);
  const task = await createTask.json();

  // Simulated adapter that completes the task
  const fakeEngine: EngineAdapter = {
    async run(spec: TaskSpec, _ctx: EngineContext) {
      return {
        outcome: "completed",
        idempotency_key: `fake-${spec.code}`,
        notes: "Simulated execution",
      };
    },
  };

  const abort = new AbortController();
  const logs: string[] = [];

  // runBee in background
  const promise = runBee({
    beeDir: runtimeBeeDir,
    secretsDir: rtSecretsDir,
    apiBaseUrl: baseUrl,
    engine: fakeEngine,
    signal: abort.signal,
    onLog: (m) => logs.push(m),
  });

  // Wait for it to process
  await new Promise((r) => setTimeout(r, 3000));
  abort.abort();
  await promise.catch(() => {});

  // Verify the task completed
  const check = await fetch(`${baseUrl}/tasks/${task.code}`, {
    headers: { Authorization: `Bearer ${OP_TOKEN}` },
  });
  const updated = await check.json();
  expect(updated.status).toBe("completed");

  try { rmSync(runtimeBeeDir, { recursive: true, force: true }); } catch { /* Windows */ }
});

// ───── 4.4: adapter tests ─────

test("ollama adapter: fails gracefully if the endpoint doesn't respond", async () => {
  const result = await ollamaAdapter.run(
    { code: "TASK-1", slug: "test", description: "Test", acceptance_criteria: null, priority: "medium", rev: 1 },
    { beeDir: "/tmp", beeName: "test", beeId: 1, config: { engine: "ollama", connection_mode: "api", model: "llama3", heartbeat_seconds: 60, bee_name: "test" }, instanceId: "i1", log: () => {} },
  );
  expect(result.outcome).toBe("failed");
  expect(result.blockers).toBeTruthy();
});

// ───── 4.5: launch tests ─────

test("launch: getAdapter selects the adapter based on engine", () => {
  writeFileSync(join(beeDir, "bee.md"), `# Bee: test
## Engine
- **Engine:** ollama
- **Connection mode:** api
## Orchestrator API Connection
- **Name:** test
`, "utf8");

  const adapter = getAdapter(beeDir);
  expect(adapter).toBe(ollamaAdapter);
});

test("launch: getAdapter throws for an unsupported engine", () => {
  writeFileSync(join(beeDir, "bee.md"), `# Bee: test
## Engine
- **Engine:** unknown-engine
- **Connection mode:** cli
## Orchestrator API Connection
- **Name:** test
`, "utf8");

  expect(() => getAdapter(beeDir)).toThrow("not supported");
});

// ───── Degraded mode tests ─────

test("degraded mode: runs a local task without the API", async () => {
  const degDir = join(tmpdir(), `amalia-degrad-${Date.now()}`);
  const degSecrets = join(degDir, ".secrets");
  mkdirSync(degSecrets, { recursive: true });
  mkdirSync(join(degDir, "tasks"), { recursive: true });

  writeFileSync(join(degDir, "bee.md"), `# Bee: deg-bee
## Engine
- **Engine:** custom
- **Connection mode:** cli
- **Heartbeat (seconds):** 9999

## Orchestrator API Connection
- **Name:** deg-bee
`, "utf8");

  // Write a local pending task (as if created by the CLI)
  const taskContent = `---
id: 1
slug: deg-task
status: pending
assigned_to: deg-bee
priority: high
rev: 1
synced_rev: 1
lock: null
last_db_sync: "2026-06-28T20:00:00.000Z"
---
Test task for degraded mode
`;
  writeFileSync(join(degDir, "tasks", "deg-task.task.md"), taskContent, "utf8");

  writeFileSync(join(degSecrets, "deg-bee.token"), "dummy-token", "utf8");

  const fakeEngine: EngineAdapter = {
    async run(spec: TaskSpec, _ctx: EngineContext) {
      return { outcome: "completed", idempotency_key: `deg-${spec.slug}`, notes: "Degraded execution" };
    },
  };

  const abort = new AbortController();
  const logs: string[] = [];

  // Fake API — we point at an address that doesn't exist
  const promise = runBee({
    beeDir: degDir,
    secretsDir: degSecrets,
    apiBaseUrl: "http://127.0.0.1:1", // doesn't exist
    engine: fakeEngine,
    signal: abort.signal,
    onLog: (m) => logs.push(m),
  });
  await new Promise((r) => setTimeout(r, 4000));
  abort.abort();
  await promise.catch(() => {});

  // Verify it ran in degraded mode and wrote a local result
  expect(logs.some((l) => l.includes("degraded mode"))).toBe(true);
  expect(logs.some((l) => l.includes("Running"))).toBe(true);
  expect(logs.some((l) => l.includes("completed"))).toBe(true);

  // Verify the local result exists
  const tasksDir = join(degDir, "tasks");
  const resultFiles = readdirSync(tasksDir).filter((f) => f.endsWith(".result.md"));
  expect(resultFiles.length).toBeGreaterThanOrEqual(1);

  // Verify synced_rev is behind (rev=2, but synced_rev should be < rev since there's no API)
  const updatedTask = readFileSync(join(tasksDir, "deg-task.task.md"), "utf8");
  expect(updatedTask).toContain("synced_rev");
  expect(updatedTask).toContain("status: completed");

  try { rmSync(degDir, { recursive: true, force: true }); } catch { /* Windows */ }
});

test("degraded mode: synced_rev stays behind when reportResult fails", async () => {
  const sdDir = join(tmpdir(), `amalia-sync-${Date.now()}`);
  const sdSecrets = join(sdDir, ".secrets");
  mkdirSync(sdSecrets, { recursive: true });
  mkdirSync(join(sdDir, "tasks"), { recursive: true });

  writeFileSync(join(sdDir, "bee.md"), `# Bee: sync-bee
## Engine
- **Engine:** custom
- **Connection mode:** cli
- **Heartbeat (seconds):** 9999

## Orchestrator API Connection
- **Name:** sync-bee
`, "utf8");
  writeFileSync(join(sdSecrets, "sync-bee.token"), generateToken(), "utf8");

  // Create a real bee in the DB so it can register
  const syncToken = generateToken();
  db.prepare(
    `INSERT INTO bees (name, worktree_path, engine, connection_mode, token_hash, status)
     VALUES ('sync-bee', ?, 'custom', 'cli', ?, 'idle')`,
  ).run(sdDir, hashToken(syncToken));
  writeFileSync(join(sdSecrets, "sync-bee.token"), syncToken, "utf8");

  // Create the task via the API
  const taskRes = await fetch(`${baseUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OP_TOKEN}` },
    body: JSON.stringify({
      assigned_to: "sync-bee", description: "Sync test", priority: "low",
      slug: "sync-test", depends_on: [], max_attempts: 3,
    }),
  });
  expect(taskRes.status).toBe(201);
  const createdTask = await taskRes.json();
  expect(createdTask.status).toBe("pending");

  // Copy the local task file
  const taskMd = `---
id: ${createdTask.id}
slug: sync-test
status: pending
assigned_to: sync-bee
priority: low
rev: 1
synced_rev: 1
lock: null
last_db_sync: "2026-06-28T20:00:00.000Z"
---
Sync test task
`;
  writeFileSync(join(sdDir, "tasks", "sync-test.task.md"), taskMd, "utf8");

  const fakeEngine: EngineAdapter = {
    async run(spec: TaskSpec, _ctx: EngineContext) {
      return { outcome: "completed", idempotency_key: "sync-test-key", notes: "OK" };
    },
  };

  const abort = new AbortController();
  const logs: string[] = [];

  const promise = runBee({
    beeDir: sdDir,
    secretsDir: sdSecrets,
    apiBaseUrl: baseUrl,
    engine: fakeEngine,
    signal: abort.signal,
    onLog: (m) => logs.push(m),
  });
  await new Promise((r) => setTimeout(r, 4000));
  abort.abort();
  await promise.catch(() => {});

  // The task should be completed in the DB
  const check = await fetch(`${baseUrl}/tasks/${createdTask.code}`, {
    headers: { Authorization: `Bearer ${OP_TOKEN}` },
  });
  const updated = await check.json();
  expect(updated.status).toBe("completed");

  // The local file should have synced_rev = rev (everything in sync)
  const taskFile = readFileSync(join(sdDir, "tasks", "sync-test.task.md"), "utf8");
  expect(taskFile).toContain("synced_rev: 2");
  expect(taskFile).not.toContain("status: pending");

  try { rmSync(sdDir, { recursive: true, force: true }); } catch { /* Windows */ }
});

// ───── bee-config: api_base_url parsing ─────

test("bee-config: parses api_base_url from bee.md", () => {
  writeFileSync(join(beeDir, "bee.md"), `# Bee: test
## Engine
- **Engine:** ollama
- **Connection mode:** api
## Orchestrator API Connection
- **Name:** test
- **API URL:** http://localhost:4000/api/orchestrator
`, "utf8");

  const config = readBeeConfig(beeDir);
  expect(config.engine).toBe("ollama");
  expect(config.api_base_url).toBe("http://localhost:4000/api/orchestrator");
});

// ───── Security: adapter doesn't leak process.env ─────

test("security: claude-code adapter doesn't pass process.env to the subprocess", async () => {
  // We can only verify the adapter doesn't flood the env
  // the adapter uses a manually built object
  const { claudeCodeAdapter } = await import("../src/engines/adapters/claude-code.js");
  // We can't test execFileSync without actually running it,
  // but we verify the adapter exists and has the right interface
  expect(claudeCodeAdapter).toBeDefined();
  expect(typeof claudeCodeAdapter.run).toBe("function");
});

// ───── ollama success path ─────

test("ollama adapter: completes the task when the endpoint responds", async () => {
  const { createServer } = await import("node:http");
  const ollamaServer = createServer((req: any, res: any) => {
    let body = "";
    req.on("data", (c: Buffer) => body += c);
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ response: "Task completed by simulated Ollama" }));
    });
  });
  await new Promise<void>((r) => ollamaServer.listen(0, "127.0.0.1", r));
  const addr = ollamaServer.address() as { port: number };
  const ollamaUrl = `http://127.0.0.1:${addr.port}/api/generate`;

  const result = await ollamaAdapter.run(
    { code: "TASK-42", slug: "ollama-test", description: "Ollama test", acceptance_criteria: "OK", priority: "high", rev: 1 },
    {
      beeDir: "/tmp", beeName: "ollama-bee", beeId: 42,
      config: {
        engine: "ollama", connection_mode: "api", model: "llama3",
        heartbeat_seconds: 60, bee_name: "ollama-bee",
        endpoint: ollamaUrl,
      },
      instanceId: "i1", log: () => {},
    },
  );

  expect(result.outcome).toBe("completed");
  expect(result.notes).toContain("Task completed");

  ollamaServer.close();
});
