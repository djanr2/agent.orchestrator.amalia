import { test, expect } from "vitest";
import { openDb, applySchema } from "../../db/index.js";
import { runMaintenance } from "./maintenance.js";
import { hashToken } from "../auth.js";

test("runMaintenance marca bees offline y libera sus tareas", () => {
  const db = openDb(":memory:");
  applySchema(db);

  db.prepare(
    `INSERT INTO bees (id, name, worktree_path, engine, connection_mode, token_hash,
      status, heartbeat_seconds, last_heartbeat_at)
     VALUES (1, 'zombie-bee', '/wt/zombie', 'opencode', 'cli', ?, 'busy', 60,
             datetime('now', '-10 minutes')),
            (2, 'healthy-bee', '/wt/health', 'opencode', 'cli', ?, 'busy', 60,
             datetime('now', '-1 minute'))`,
  ).run(hashToken("z-token"), hashToken("h-token"));

  db.prepare(
    `INSERT INTO tasks (code, slug, assigned_to, created_by, status, description, locked_by, lease_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("TASK-1", "stuck", 1, 1, "in_progress", "Tarea atascada", 1, "2020-01-01 00:00:00");

  db.prepare(
    "INSERT INTO tasks (code, slug, assigned_to, created_by, status, description) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("TASK-2", "pending-other", 2, 1, "pending", "Tarea pendiente de otro bee");

  db.prepare(
    "INSERT INTO tasks (code, slug, assigned_to, created_by, status, description) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("TASK-3", "pending-own", 1, 1, "pending", "Tarea pendiente del zombie");

  runMaintenance(db, null);

  const zombie = db.prepare("SELECT status FROM bees WHERE id = 1").get() as { status: string };
  expect(zombie.status).toBe("offline");

  const healthy = db.prepare("SELECT status FROM bees WHERE id = 2").get() as { status: string };
  expect(healthy.status).toBe("busy");

  // bee-offline loop sets in_progress tasks back to pending
  const stuckTask = db
    .prepare("SELECT status, locked_by FROM tasks WHERE code = 'TASK-1'")
    .get() as { status: string; locked_by: number | null };
  expect(stuckTask.status).toBe("pending");
  expect(stuckTask.locked_by).toBeNull();

  const pendingTask = db
    .prepare("SELECT status FROM tasks WHERE code = 'TASK-2'")
    .get() as { status: string };
  expect(pendingTask.status).toBe("pending");

  const ownPending = db
    .prepare("SELECT status FROM tasks WHERE code = 'TASK-3'")
    .get() as { status: string };
  expect(ownPending.status).toBe("pending");
});

test("watchdog bloquea tarea con lease vencido si el bee sigue online", () => {
  const db = openDb(":memory:");
  applySchema(db);

  db.prepare(
    `INSERT INTO bees (id, name, worktree_path, engine, connection_mode, token_hash,
      status, heartbeat_seconds, last_heartbeat_at)
     VALUES (1, 'slow-bee', '/wt/slow', 'opencode', 'cli', ?, 'busy', 60,
             datetime('now', '-30 seconds'))`,
  ).run(hashToken("s-token"));

  // Tarea con lease vencido, bee online
  db.prepare(
    `INSERT INTO tasks (code, slug, assigned_to, created_by, status, description, locked_by, claimed_at, lease_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("TASK-L", "lease-expired", 1, 1, "in_progress", "Lease vencido, bee online", 1,
         "2020-01-01 00:00:00", "2020-01-01 00:00:00");

  runMaintenance(db, null);

  expect(
    (db.prepare("SELECT status FROM bees WHERE id = 1").get() as { status: string }).status,
  ).toBe("busy");

  const task = db
    .prepare("SELECT status, block_reason, locked_by FROM tasks WHERE code = 'TASK-L'")
    .get() as { status: string; block_reason: string | null; locked_by: number | null };
  expect(task.status).toBe("blocked");
  expect(task.block_reason).toBe("timeout");
  expect(task.locked_by).toBeNull();
});

test("watchdog bloquea tarea que excede max_run_seconds incluso con lease fresco", () => {
  const db = openDb(":memory:");
  applySchema(db);

  db.prepare(
    `INSERT INTO bees (id, name, worktree_path, engine, connection_mode, token_hash,
      status, heartbeat_seconds, last_heartbeat_at)
     VALUES (1, 'runner-bee', '/wt/run', 'opencode', 'cli', ?, 'busy', 60,
             datetime('now', '-5 seconds'))`,
  ).run(hashToken("r-token"));

  // Tarea con max_run_seconds=60, claimed_at hace 120s (excedido), pero lease fresco (+5 min)
  db.prepare(
    `INSERT INTO tasks (code, slug, assigned_to, created_by, status, description,
      locked_by, claimed_at, lease_expires_at, max_run_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("TASK-M", "max-run", 1, 1, "in_progress", "Corrió más de max_run_seconds", 1,
         "2020-01-01 00:00:00", "2125-01-01 00:00:00", 60);

  runMaintenance(db, null);

  expect(
    (db.prepare("SELECT status FROM bees WHERE id = 1").get() as { status: string }).status,
  ).toBe("busy");

  const task = db
    .prepare("SELECT status, block_reason, locked_by FROM tasks WHERE code = 'TASK-M'")
    .get() as { status: string; block_reason: string | null; locked_by: number | null };
  expect(task.status).toBe("blocked");
  expect(task.block_reason).toBe("timeout");
  expect(task.locked_by).toBeNull();
});

test("watchdog NO bloquea tarea con lease fresco y max_run_seconds no excedido", () => {
  const db = openDb(":memory:");
  applySchema(db);

  db.prepare(
    `INSERT INTO bees (id, name, worktree_path, engine, connection_mode, token_hash,
      status, heartbeat_seconds, last_heartbeat_at)
     VALUES (1, 'fine-bee', '/wt/fine', 'opencode', 'cli', ?, 'busy', 60,
             datetime('now', '-5 seconds'))`,
  ).run(hashToken("f-token"));

  db.prepare(
    `INSERT INTO tasks (code, slug, assigned_to, created_by, status, description,
      locked_by, claimed_at, lease_expires_at, max_run_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`,
  ).run("TASK-F", "fine", 1, 1, "in_progress", "Todo ok", 1,
         "2125-01-01 00:00:00", 9999999);

  runMaintenance(db, null);

  const task = db
    .prepare("SELECT status, block_reason FROM tasks WHERE code = 'TASK-F'")
    .get() as { status: string; block_reason: string | null };
  expect(task.status).toBe("in_progress");
});
