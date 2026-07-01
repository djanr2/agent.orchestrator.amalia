import type { DatabaseSync } from "node:sqlite";
import type { Server as IoServer } from "socket.io";
import { transaction } from "../db/index.js";
import { emitEvent } from "./events.js";
import type { AuthIdentity } from "./auth.js";

export interface Task {
  id: number;
  code: string;
  slug: string;
  assigned_to: number;
  created_by: number;
  status: string;
  priority: string;
  description: string;
  acceptance_criteria: string | null;
  attempts: number;
  max_attempts: number;
  block_reason: string | null;
  max_run_seconds: number | null;
  rev: number;
  locked_by: number | null;
  locked_by_instance: string | null;
  lease_expires_at: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  assigned_to: string;
  description: string;
  acceptance_criteria?: string;
  priority: "high" | "medium" | "low";
  slug: string;
  depends_on: string[];
  max_attempts: number;
  max_run_seconds?: number;
}

export interface ClaimResult {
  claimed: boolean;
  task?: Task;
}

export interface ReportResultInput {
  outcome: "completed" | "failed";
  idempotency_key: string;
  files_changed?: string[];
  decisions?: string;
  blockers?: string;
  notes?: string;
}

export function wouldCreateCycle(db: DatabaseSync, taskId: number, dependsOnId: number): boolean {
  const visited = new Set<number>();
  const stack = [dependsOnId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const deps = db
      .prepare("SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?")
      .all(current) as { depends_on_task_id: number }[];
    for (const d of deps) {
      stack.push(d.depends_on_task_id);
    }
  }
  return false;
}

export function createTask(
  db: DatabaseSync,
  io: IoServer | null,
  creatorId: number,
  input: CreateTaskInput,
): Task {
  return transaction(db, () => {
    const bee = db
      .prepare("SELECT id FROM bees WHERE name = ?")
      .get(input.assigned_to) as { id: number } | undefined;
    if (!bee) {
      const err = new Error("BEE_NOT_FOUND");
      (err as any).statusCode = 404;
      throw err;
    }

    const deps: number[] = [];
    for (const depCode of input.depends_on) {
      const dep = db
        .prepare("SELECT id FROM tasks WHERE code = ?")
        .get(depCode) as { id: number } | undefined;
      if (!dep) {
        const err = new Error(`DEP_NOT_FOUND: ${depCode}`);
        (err as any).statusCode = 404;
        throw err;
      }
      deps.push(dep.id);
    }

    const placeholderCode = `_TEMP_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const placeholderSlug = `_temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const info = db.prepare(
      `INSERT INTO tasks (code, slug, assigned_to, created_by, status, priority, description,
        acceptance_criteria, max_attempts, max_run_seconds, block_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      placeholderCode,
      placeholderSlug,
      bee.id,
      creatorId,
      "pending",
      input.priority,
      input.description,
      input.acceptance_criteria ?? null,
      input.max_attempts,
      input.max_run_seconds ?? null,
      null,
    );
    const taskId = Number(info.lastInsertRowid);
    const code = `TASK-${taskId}`;

    let slug = input.slug;
    const existing = db
      .prepare("SELECT id FROM tasks WHERE assigned_to = ? AND slug = ? AND id != ?")
      .get(bee.id, slug, taskId);
    if (existing) {
      slug = `${slug}-${code.toLowerCase()}`;
    }

    for (const depId of deps) {
      if (wouldCreateCycle(db, taskId, depId)) {
        const err = new Error("CYCLE_DETECTED");
        (err as any).statusCode = 400;
        throw err;
      }
    }

    let status = "pending";
    let blockReason: string | null = null;
    if (deps.length > 0) {
      const hasUncompleted = deps.some((depId) => {
        const t = db
          .prepare("SELECT status FROM tasks WHERE id = ?")
          .get(depId) as { status: string };
        return t.status !== "completed";
      });
      if (hasUncompleted) {
        status = "blocked";
        blockReason = "deps_unresolved";
      }
    }

    db.prepare(
      `UPDATE tasks
       SET code = ?, slug = ?, status = ?, block_reason = ?
       WHERE id = ?`,
    ).run(code, slug, status, blockReason, taskId);

    for (const depId of deps) {
      db.prepare(
        "INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)",
      ).run(taskId, depId);
    }

    emitEvent(db, io, "task:created", { taskId, code, slug, assignedTo: bee.id });

    return db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as unknown as Task;
  });
}

export function listTasks(
  db: DatabaseSync,
  filters?: { status?: string[]; assigned_to?: string },
): Task[] {
  let sql = "SELECT * FROM tasks";
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (filters?.status && filters.status.length > 0) {
    const placeholders = filters.status.map(() => "?").join(",");
    conditions.push(`status IN (${placeholders})`);
    params.push(...filters.status);
  }

  if (filters?.assigned_to) {
    conditions.push("assigned_to = (SELECT id FROM bees WHERE name = ?)");
    params.push(filters.assigned_to);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  sql += " ORDER BY id";
  return db.prepare(sql).all(...(params as any)) as unknown as Task[];
}

export function claimTask(
  db: DatabaseSync,
  io: IoServer | null,
  beeId: number,
  taskCode: string,
  instanceId: string,
  heartbeatSeconds: number,
): ClaimResult {
  return transaction(db, () => {
    const task = db
      .prepare("SELECT id, status, assigned_to FROM tasks WHERE code = ?")
      .get(taskCode) as { id: number; status: string; assigned_to: number } | undefined;
    if (!task) {
      const err = new Error("TASK_NOT_FOUND");
      (err as any).statusCode = 404;
      throw err;
    }

    const info = db
      .prepare(
        `UPDATE tasks
         SET status = 'in_progress',
             locked_by = ?,
             locked_by_instance = ?,
             lease_expires_at = datetime('now', '+' || (? * 3) || ' seconds'),
             attempts = attempts + 1,
             rev = rev + 1,
             claimed_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ? AND assigned_to = ? AND status = 'pending'`,
      )
      .run(beeId, instanceId, heartbeatSeconds, task.id, beeId);

    if (info.changes === 0) {
      return { claimed: false };
    }

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id) as unknown as Task;
    emitEvent(db, io, "task:status_changed", {
      taskId: task.id,
      code: taskCode,
      status: "in_progress",
    });
    return { claimed: true, task: updated };
  }, true);
}

export function reportResult(
  db: DatabaseSync,
  io: IoServer | null,
  beeId: number,
  taskCode: string,
  input: ReportResultInput,
): { result: any; task: Task } {
  return transaction(db, () => {
    const task = db
      .prepare("SELECT * FROM tasks WHERE code = ?")
      .get(taskCode) as unknown as Task | undefined;
    if (!task) {
      const err = new Error("TASK_NOT_FOUND");
      (err as any).statusCode = 404;
      throw err;
    }

    const existing = db
      .prepare("SELECT * FROM results WHERE task_id = ? AND idempotency_key = ?")
      .get(task.id, input.idempotency_key) as any | undefined;
    if (existing) {
      const currentTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id) as unknown as Task;
      return { result: existing, task: currentTask };
    }

    if (task.locked_by !== beeId) {
      const err = new Error("NOT_LEASE_OWNER");
      (err as any).statusCode = 409;
      throw err;
    }

    db.prepare(
      `INSERT INTO results (task_id, bee_id, attempt, idempotency_key, outcome,
        files_changed, decisions, blockers, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      task.id,
      beeId,
      task.attempts,
      input.idempotency_key,
      input.outcome,
      input.files_changed ? JSON.stringify(input.files_changed) : null,
      input.decisions ?? null,
      input.blockers ?? null,
      input.notes ?? null,
    );

    if (input.outcome === "completed") {
      db.prepare(
        `UPDATE tasks
         SET status = 'completed',
             locked_by = NULL,
             locked_by_instance = NULL,
             lease_expires_at = NULL,
             rev = rev + 1,
             updated_at = datetime('now')
         WHERE id = ?`,
      ).run(task.id);
      unblockDependents(db, io, task.id);
    } else {
      if (task.attempts >= task.max_attempts) {
        db.prepare(
          `UPDATE tasks
           SET status = 'blocked',
               block_reason = 'retries_exhausted',
               locked_by = NULL,
               locked_by_instance = NULL,
               lease_expires_at = NULL,
               rev = rev + 1,
               updated_at = datetime('now')
           WHERE id = ?`,
        ).run(task.id);
        propagateFailure(db, io, task.id);
      } else {
        db.prepare(
          `UPDATE tasks
           SET status = 'pending',
               locked_by = NULL,
               locked_by_instance = NULL,
               lease_expires_at = NULL,
               rev = rev + 1,
               updated_at = datetime('now')
           WHERE id = ?`,
        ).run(task.id);
      }
    }

    const result = db
      .prepare("SELECT * FROM results WHERE task_id = ? AND idempotency_key = ?")
      .get(task.id, input.idempotency_key) as any;
    const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id) as unknown as Task;

    emitEvent(db, io, "task:status_changed", {
      taskId: task.id,
      code: taskCode,
      status: updatedTask.status,
    });

    return { result, task: updatedTask };
  });
}

/** Manual operator status override. Moving a task to `pending` resets
 *  `attempts` and clears `block_reason` — otherwise a task blocked by
 *  `retries_exhausted` would immediately re-block on the next failed claim,
 *  since claimTask does not check attempts on its own. */
export function setTaskStatus(
  db: DatabaseSync,
  io: IoServer | null,
  taskCode: string,
  newStatus: string,
): Task | undefined {
  return transaction(db, () => {
    const info = newStatus === "pending"
      ? db.prepare(
          "UPDATE tasks SET status = ?, attempts = 0, block_reason = NULL, rev = rev + 1, updated_at = datetime('now') WHERE code = ?",
        ).run(newStatus, taskCode)
      : db.prepare(
          "UPDATE tasks SET status = ?, rev = rev + 1, updated_at = datetime('now') WHERE code = ?",
        ).run(newStatus, taskCode);

    if (info.changes === 0) return undefined;

    const updated = db.prepare("SELECT * FROM tasks WHERE code = ?").get(taskCode) as unknown as Task;
    emitEvent(db, io, "task:status_changed", {
      taskId: updated.id,
      code: taskCode,
      status: updated.status,
    });
    return updated;
  });
}

export function unblockDependents(db: DatabaseSync, io: IoServer | null, completedTaskId: number): void {
  const dependents = db
    .prepare("SELECT task_id FROM task_dependencies WHERE depends_on_task_id = ?")
    .all(completedTaskId) as { task_id: number }[];

  for (const dep of dependents) {
    const allDeps = db
      .prepare("SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?")
      .all(dep.task_id) as { depends_on_task_id: number }[];

    const allCompleted = allDeps.every((d) => {
      const t = db
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(d.depends_on_task_id) as { status: string };
      return t.status === "completed";
    });

    if (allCompleted) {
      const t = db
        .prepare("SELECT status, block_reason FROM tasks WHERE id = ?")
        .get(dep.task_id) as { status: string; block_reason: string | null };
      if (t.status === "blocked" && t.block_reason === "deps_unresolved") {
        db.prepare(
          `UPDATE tasks
           SET status = 'pending',
               block_reason = NULL,
               rev = rev + 1,
               updated_at = datetime('now')
           WHERE id = ?`,
        ).run(dep.task_id);
        emitEvent(db, io, "task:status_changed", { taskId: dep.task_id, status: "pending" });
      }
    }
  }
}

export function propagateFailure(db: DatabaseSync, io: IoServer | null, failedTaskId: number): void {
  const dependents = db
    .prepare("SELECT task_id FROM task_dependencies WHERE depends_on_task_id = ?")
    .all(failedTaskId) as { task_id: number }[];

  for (const dep of dependents) {
    const t = db
      .prepare("SELECT status FROM tasks WHERE id = ?")
      .get(dep.task_id) as { status: string };
    if (t.status === "blocked" || t.status === "pending") {
      db.prepare(
        `UPDATE tasks
         SET status = 'blocked',
             block_reason = 'upstream_failed',
             rev = rev + 1,
             updated_at = datetime('now')
         WHERE id = ?`,
      ).run(dep.task_id);
      emitEvent(db, io, "task:status_changed", {
        taskId: dep.task_id,
        status: "blocked",
        block_reason: "upstream_failed",
      });
    }
  }
}
