import type { DatabaseSync } from "node:sqlite";
import type { Server as IoServer } from "socket.io";

export type EventType =
  | "task:created"
  | "task:status_changed"
  | "bee:registered"
  | "bee:heartbeat"
  | "bee:offline"
  | "integration:success"
  | "integration:conflict"
  | "reconcile:conflict"
  | "update:conflict";

export function emitEvent(
  db: DatabaseSync,
  io: IoServer | null,
  type: EventType,
  payload: unknown,
): number {
  const info = db
    .prepare("INSERT INTO events (type, payload) VALUES (?, ?)")
    .run(type, JSON.stringify(payload));
  const id = Number(info.lastInsertRowid);
  if (io) io.emit(type, { id, type, payload });
  return id;
}
