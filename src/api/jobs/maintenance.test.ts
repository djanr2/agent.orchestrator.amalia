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
    "INSERT INTO tasks (code, slug, assigned_to, created_by, status, description, locked_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("TASK-1", "stuck", 1, 1, "in_progress", "Tarea atascada", 1);

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
