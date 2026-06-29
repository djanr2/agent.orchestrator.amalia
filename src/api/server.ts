import { createServer as createHttpServer } from "node:http";
import express from "express";
import { Server as IoServer } from "socket.io";
import type { DatabaseSync } from "node:sqlite";
import { identifyByToken } from "./auth.js";
import { registerRoutes } from "./routes/index.js";

export interface ServerOptions {
  db: DatabaseSync;
  port?: number;
  host?: string;
  staticDir?: string;
}

export interface ServerHandle {
  app: express.Express;
  httpServer: ReturnType<typeof createHttpServer>;
  io: IoServer;
  listen: (port?: number) => Promise<void>;
  close: () => Promise<void>;
}

export function createServer(options: ServerOptions): ServerHandle {
  const db = options.db;
  const port = options.port ?? 4000;
  const host = options.host ?? "127.0.0.1";

  const app = express();
  app.use(express.json());

  if (options.staticDir) {
    app.use(express.static(options.staticDir));
  }

  const httpServer = createHttpServer(app);
  const io = new IoServer(httpServer, {
    cors: { origin: ["http://127.0.0.1:" + port, "http://localhost:" + port] },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      next(new Error("UNAUTHORIZED"));
      return;
    }
    const identity = identifyByToken(db, token);
    if (!identity) {
      next(new Error("UNAUTHORIZED"));
      return;
    }
    (socket as any).identity = identity;
    next();
  });

  const router = express.Router();
  registerRoutes(router, db, io);
  app.use("/api/orchestrator", router);

  return {
    app,
    httpServer,
    io,
    listen: (p?: number) =>
      new Promise<void>((resolve) => {
        httpServer.listen(p ?? port, host, () => resolve());
      }),
    close: () =>
      new Promise<void>((resolve) => {
        io.close();
        httpServer.close(() => resolve());
      }),
  };
}
