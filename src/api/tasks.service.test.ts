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

test("crear tarea sin dependencias queda pending", () => {
  const db = setupDb();
  const task = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Crear esquema SQL",
    priority: "high",
    slug: "crear-esquema",
    depends_on: [],
    max_attempts: 3,
  });
  expect(task.status).toBe("pending");
  expect(task.code).toMatch(/^TASK-\d+$/);
  expect(task.slug).toBe("crear-esquema");
});

test("crear tarea con dependencia no completada queda blocked (deps_unresolved)", () => {
  const db = setupDb();
  const dep = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Dependencia",
    priority: "medium",
    slug: "dep",
    depends_on: [],
    max_attempts: 3,
  });
  const task = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Tarea que depende",
    priority: "medium",
    slug: "dependiente",
    depends_on: [dep.code],
    max_attempts: 3,
  });
  expect(task.status).toBe("blocked");
  expect(task.block_reason).toBe("deps_unresolved");
});

test("wouldCreateCycle detecta ciclo real", () => {
  const db = setupDb();
  const a = createTask(db, null, 1, {
    assigned_to: "database-bee", description: "Tarea A", priority: "medium",
    slug: "a", depends_on: [], max_attempts: 3,
  });
  const b = createTask(db, null, 1, {
    assigned_to: "database-bee", description: "Tarea B", priority: "medium",
    slug: "b", depends_on: [a.code], max_attempts: 3,
  });
  // B depende de A, entonces si A quisiera depender de B habría ciclo: can B reach A?
  expect(wouldCreateCycle(db, a.id, b.id)).toBe(true);
  // A no depende de nadie, entonces si C depende de A no hay ciclo
  expect(wouldCreateCycle(db, b.id, a.id)).toBe(false);
  expect(wouldCreateCycle(db, 999, a.id)).toBe(false);
});

test("slug duplicado se sufija con el code", () => {
  const db = setupDb();
  const t1 = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Primera",
    priority: "low",
    slug: "mismo-slug",
    depends_on: [],
    max_attempts: 3,
  });
  const t2 = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Segunda",
    priority: "low",
    slug: "mismo-slug",
    depends_on: [],
    max_attempts: 3,
  });
  expect(t1.slug).toBe("mismo-slug");
  expect(t2.slug).toBe(`mismo-slug-task-${t2.code.toLowerCase()}`);
});

test("claimTask: primera claim exitosa, segunda falla (claimed:false)", () => {
  const db = setupDb();
  const task = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Tarea para claim",
    priority: "medium",
    slug: "para-claim",
    depends_on: [],
    max_attempts: 3,
  });
  const r1 = claimTask(db, null, 2, task.code, "inst-1", 60);
  expect(r1.claimed).toBe(true);
  expect(r1.task!.status).toBe("in_progress");
  const r2 = claimTask(db, null, 2, task.code, "inst-2", 60);
  expect(r2.claimed).toBe(false);
});

test("completar tarea desbloquea a su dependiente", () => {
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

test("fallar agotando max_attempts bloquea dependiente con upstream_failed", () => {
  const db = setupDb();
  const depT = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Dep que falla",
    priority: "medium",
    slug: "dep-falla",
    depends_on: [],
    max_attempts: 1,
  });
  const main = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Dependiente",
    priority: "medium",
    slug: "deps-falla",
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

test("idempotency_key evita duplicar resultados", () => {
  const db = setupDb();
  const task = createTask(db, null, 1, {
    assigned_to: "database-bee",
    description: "Tarea",
    priority: "medium",
    slug: "idempotente",
    depends_on: [],
    max_attempts: 3,
  });
  const claim = claimTask(db, null, 2, task.code, "inst-1", 60);
  expect(claim.claimed).toBe(true);
  const r1 = reportResult(db, null, 2, task.code, {
    outcome: "completed",
    idempotency_key: "idem-unico",
  });
  const r2 = reportResult(db, null, 2, task.code, {
    outcome: "completed",
    idempotency_key: "idem-unico",
  });
  expect(r1.result.id).toBe(r2.result.id);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM results WHERE task_id = ?")
    .get(task.id) as { c: number };
  expect(count.c).toBe(1);
});
