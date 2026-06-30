import { test, expect } from "vitest";
import { openDb, applySchema } from "../db/index.js";
import { createTask, listTasks, claimTask, reportResult, wouldCreateCycle } from "./tasks.service.js";
import { hashToken } from "./auth.js";

function setupDb() {
  const db = openDb(":memory:");
  applySchema(db);
  db.prepare(
    `INSERT INTO bees (id, name, worktree_path, engine, connection_mode, token_hash, status)
     VALUES (1, 'amalia', '/worktrees/amalia', 'opencode', 'cli', ?, 'idle'),
            (2, 'database-bee', '/worktrees/db', 'claude-code', 'cli', ?, 'idle')`,
  ).run(hashToken("op-token"), hashToken("bee-token"));
  return db;
}

test("creating a task with no dependencies ends up pending", () => {
  const db = setupDb();
  const task = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Create SQL schema",
    priority: "high",
    slug: "create-schema",
    depends_on: [],
    max_attempts: 3,
  });
  expect(task.status).toBe("pending");
  expect(task.code).toMatch(/^TASK-\d+$/);
  expect(task.slug).toBe("create-schema");
});

test("creating a task with an unfinished dependency ends up blocked (deps_unresolved)", () => {
  const db = setupDb();
  const dep = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Dependency",
    priority: "medium",
    slug: "dep",
    depends_on: [],
    max_attempts: 3,
  });
  const task = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Task that depends on another",
    priority: "medium",
    slug: "dependent",
    depends_on: [dep.code],
    max_attempts: 3,
  });
  expect(task.status).toBe("blocked");
  expect(task.block_reason).toBe("deps_unresolved");
});

test("wouldCreateCycle detects a real cycle", () => {
  const db = setupDb();
  const a = createTask(db, null, 1, {
    assigned_to: "database-bee", description: "Task A", priority: "medium",
    slug: "a", depends_on: [], max_attempts: 3,
  });
  const b = createTask(db, null, 1, {
    assigned_to: "database-bee", description: "Task B", priority: "medium",
    slug: "b", depends_on: [a.code], max_attempts: 3,
  });
  // B depends on A, so if A wanted to depend on B there would be a cycle: can B reach A?
  expect(wouldCreateCycle(db, a.id, b.id)).toBe(true);
  // A depends on nothing, so if C depends on A there's no cycle
  expect(wouldCreateCycle(db, b.id, a.id)).toBe(false);
  expect(wouldCreateCycle(db, 999, a.id)).toBe(false);
});

test("a duplicate slug gets suffixed with the code", () => {
  const db = setupDb();
  const t1 = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "First",
    priority: "low",
    slug: "same-slug",
    depends_on: [],
    max_attempts: 3,
  });
  const t2 = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Second",
    priority: "low",
    slug: "same-slug",
    depends_on: [],
    max_attempts: 3,
  });
  expect(t1.slug).toBe("same-slug");
  expect(t2.slug).toBe(`same-slug-${t2.code.toLowerCase()}`);
});

test("claimTask: first claim succeeds, second fails (claimed:false)", () => {
  const db = setupDb();
  const task = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Task for claim",
    priority: "medium",
    slug: "for-claim",
    depends_on: [],
    max_attempts: 3,
  });
  const r1 = claimTask(db, null, 2, task.code, "inst-1", 60);
  expect(r1.claimed).toBe(true);
  expect(r1.task!.status).toBe("in_progress");
  const r2 = claimTask(db, null, 2, task.code, "inst-2", 60);
  expect(r2.claimed).toBe(false);
});

test("completing a task unblocks its dependent", () => {
  const db = setupDb();
  const dep = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Dep",
    priority: "medium",
    slug: "dep",
    depends_on: [],
    max_attempts: 3,
  });
  const main = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Main",
    priority: "medium",
    slug: "main",
    depends_on: [dep.code],
    max_attempts: 3,
  });
  expect(main.status).toBe("blocked");
  claimTask(db, null, 2, dep.code, "inst-1", 60);
  reportResult(db, null, 2, dep.code, {
    outcome: "completed",
    idempotency_key: "idem-1",
  });
  const updated = db
    .prepare("SELECT status, block_reason FROM tasks WHERE id = ?")
    .get(main.id) as any;
  expect(updated.status).toBe("pending");
  expect(updated.block_reason).toBeNull();
});

test("failing and exhausting max_attempts blocks the dependent with upstream_failed", () => {
  const db = setupDb();
  const depT = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Dependency that fails",
    priority: "medium",
    slug: "dep-fail",
    depends_on: [],
    max_attempts: 1,
  });
  const main = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Dependent",
    priority: "medium",
    slug: "deps-fail",
    depends_on: [depT.code],
    max_attempts: 3,
  });
  claimTask(db, null, 2, depT.code, "inst-1", 60);
  reportResult(db, null, 2, depT.code, {
    outcome: "failed",
    idempotency_key: "idem-fail-1",
  });
  const depStatus = db
    .prepare("SELECT status, block_reason FROM tasks WHERE id = ?")
    .get(depT.id) as any;
  expect(depStatus.status).toBe("blocked");
  expect(depStatus.block_reason).toBe("retries_exhausted");
  const mainStatus = db
    .prepare("SELECT status, block_reason FROM tasks WHERE id = ?")
    .get(main.id) as any;
  expect(mainStatus.status).toBe("blocked");
  expect(mainStatus.block_reason).toBe("upstream_failed");
});

test("idempotency_key avoids duplicating results", () => {
  const db = setupDb();
  const task = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Task",
    priority: "medium",
    slug: "idempotent",
    depends_on: [],
    max_attempts: 3,
  });
  const claim = claimTask(db, null, 2, task.code, "inst-1", 60);
  expect(claim.claimed).toBe(true);
  const r1 = reportResult(db, null, 2, task.code, {
    outcome: "completed",
    idempotency_key: "idem-unique",
  });
  const r2 = reportResult(db, null, 2, task.code, {
    outcome: "completed",
    idempotency_key: "idem-unique",
  });
  expect(r1.result.id).toBe(r2.result.id);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM results WHERE task_id = ?")
    .get(task.id) as { c: number };
  expect(count.c).toBe(1);
});
