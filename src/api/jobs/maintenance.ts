import type { DatabaseSync } from "node:sqlite";
import type { Server as IoServer } from "socket.io";
import { emitEvent } from "../events.js";

export function runMaintenance(db: DatabaseSync, io: IoServer | null): void {
  const now = new Date().toISOString();

  const offlineBees = db
    .prepare(
      `UPDATE bees
       SET status = 'offline'
       WHERE status != 'offline'
         AND last_heartbeat_at IS NOT NULL
         AND datetime(last_heartbeat_at, '+' || (heartbeat_seconds * 3) || ' seconds') < datetime(?)
       RETURNING id, name`,
    )
    .all(now) as { id: number; name: string }[];

  for (const bee of offlineBees) {
    db.prepare(
      `UPDATE tasks
       SET status = 'pending',
           locked_by = NULL,
           locked_by_instance = NULL,
           lease_expires_at = NULL,
           rev = rev + 1,
           updated_at = datetime('now')
       WHERE locked_by = ? AND status = 'in_progress'`,
    ).run(bee.id);
    emitEvent(db, io, "bee:offline", { beeId: bee.id, name: bee.name });
  }

  const DEFAULT_MAX_RUN = 1800;
  const stuck = db
    .prepare(
      `UPDATE tasks
       SET status = 'blocked',
           block_reason = 'timeout',
           locked_by = NULL,
           locked_by_instance = NULL,
           lease_expires_at = NULL,
           rev = rev + 1,
           updated_at = datetime('now')
       WHERE status = 'in_progress'
         AND (
           (lease_expires_at IS NOT NULL AND lease_expires_at < datetime(?))
           OR
           (claimed_at IS NOT NULL AND datetime(claimed_at, '+' || COALESCE(max_run_seconds, ?) || ' seconds') < datetime(?))
         )
       RETURNING id, code`,
    )
    .all(now, DEFAULT_MAX_RUN, now) as { id: number; code: string }[];

  for (const t of stuck) {
    emitEvent(db, io, "task:status_changed", {
      taskId: t.id,
      code: t.code,
      status: "blocked",
      block_reason: "timeout",
    });
  }

  const RETENTION_DAYS = 7;
  db.prepare(
    `DELETE FROM events
     WHERE created_at < datetime('now', '-' || ? || ' days')`,
  ).run(RETENTION_DAYS);
}
