import type { DatabaseSync } from "node:sqlite";
import type { Server as IoServer } from "socket.io";
import { runMaintenance } from "./maintenance.js";

export interface SchedulerHandle {
  stop: () => void;
}

export function startScheduler(
  db: DatabaseSync,
  io: IoServer | null,
  intervalMs: number = 15000,
): SchedulerHandle {
  const timer = setInterval(() => {
    runMaintenance(db, io);
  }, intervalMs);

  runMaintenance(db, io);

  return {
    stop: () => clearInterval(timer),
  };
}
