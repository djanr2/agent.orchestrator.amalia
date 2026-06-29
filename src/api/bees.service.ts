import type { DatabaseSync } from "node:sqlite";
import type { Server as IoServer } from "socket.io";
import { emitEvent } from "./events.js";

export interface Bee {
  id: number;
  name: string;
  worktree_path: string;
  role_summary: string | null;
  engine: string;
  connection_mode: string;
  model: string | null;
  status: string;
  token_hash: string;
  heartbeat_seconds: number;
  last_heartbeat_at: string | null;
  created_at: string;
}

export interface RegisterBeeInput {
  worktree_path: string;
  engine: string;
  connection_mode: string;
  model?: string;
  role_summary?: string;
  heartbeat_seconds?: number;
}

export function registerOrUpdateBee(
  db: DatabaseSync,
  io: IoServer | null,
  beeId: number,
  input: RegisterBeeInput,
): Bee {
  db.prepare(
    `UPDATE bees
     SET worktree_path = ?,
         engine = ?,
         connection_mode = ?,
         model = ?,
         role_summary = ?,
         heartbeat_seconds = ?,
         status = 'idle',
         last_heartbeat_at = datetime('now')
     WHERE id = ?`,
  ).run(
    input.worktree_path,
    input.engine,
    input.connection_mode,
    input.model ?? null,
    input.role_summary ?? null,
    input.heartbeat_seconds ?? 60,
    beeId,
  );
  emitEvent(db, io, "bee:registered", { beeId });
  return db.prepare("SELECT * FROM bees WHERE id = ?").get(beeId) as unknown as Bee;
}

export function heartbeat(db: DatabaseSync, beeId: number): void {
  db.prepare(
    `UPDATE bees
     SET last_heartbeat_at = datetime('now'),
         status = CASE WHEN status = 'offline' THEN 'idle' ELSE status END
     WHERE id = ?`,
  ).run(beeId);
}

export function listBees(db: DatabaseSync): Bee[] {
  return db.prepare("SELECT * FROM bees ORDER BY name").all() as unknown as Bee[];
}
