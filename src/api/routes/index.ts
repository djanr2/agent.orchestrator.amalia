import type { Router } from "express";
import type { DatabaseSync } from "node:sqlite";
import type { Server as IoServer } from "socket.io";
import { authMiddleware, requireOperator } from "../middleware/auth.js";
import { registerBeeSchema, createTaskSchema, claimSchema, resultSchema, COMMIT_RE } from "../validation.js";
import { registerOrUpdateBee, heartbeat, listBees } from "../bees.service.js";
import { createTask, listTasks, claimTask, reportResult } from "../tasks.service.js";

export function registerRoutes(
  router: Router,
  db: DatabaseSync,
  io: IoServer | null,
): void {
  const auth = authMiddleware(db);

  router.post("/bees/register", auth, (req, res) => {
    if (!req.identity) return;
    const parsed = registerBeeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() });
      return;
    }
    const bee = registerOrUpdateBee(db, io, req.identity.beeId, parsed.data);
    res.json(bee);
  });

  router.patch("/bees/:id/heartbeat", auth, (req, res) => {
    if (!req.identity) return;
    const beeId = Number(req.params.id);
    if (req.identity.beeId !== beeId) {
      res.status(403).json({ error: "FORBIDDEN", message: "Solo puedes hacer heartbeat propio" });
      return;
    }
    heartbeat(db, beeId);
    res.json({ ok: true });
  });

  router.get("/bees", auth, (_req, res) => {
    const bees = listBees(db);
    res.json(bees);
  });

  router.post("/tasks", auth, requireOperator, (req, res) => {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() });
      return;
    }
    try {
      const task = createTask(db, io, req.identity!.beeId, parsed.data);
      res.status(201).json(task);
    } catch (e: any) {
      const status = e.statusCode ?? 500;
      res.status(status).json({ error: e.message });
    }
  });

  router.get("/tasks/:code", auth, (req, res) => {
    const task = db
      .prepare("SELECT * FROM tasks WHERE code = ?")
      .get(req.params.code as string);
    if (!task) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    res.json(task);
  });

  router.get("/tasks", auth, (req, res) => {
    const filters: { status?: string[]; assigned_to?: string } = {};
    if (req.query.status) {
      filters.status = (req.query.status as unknown as string).split(",");
    }
    if (req.query.assigned_to) {
      filters.assigned_to = req.query.assigned_to as unknown as string;
    }
    const tasks = listTasks(db, filters);
    res.json(tasks);
  });

  router.post("/tasks/:code/claim", auth, (req, res) => {
    if (!req.identity) return;
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() });
      return;
    }
    try {
      const result = claimTask(db, io, req.identity.beeId, req.params.code as string, parsed.data.instance_id, 60);
      if (!result.claimed) {
        res.status(409).json({ claimed: false, message: "Tarea no disponible para claim" });
        return;
      }
      res.json(result);
    } catch (e: any) {
      const status = e.statusCode ?? 500;
      res.status(status).json({ error: e.message });
    }
  });

  router.post("/tasks/:code/results", auth, (req, res) => {
    if (!req.identity) return;
    const parsed = resultSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() });
      return;
    }
    try {
      const result = reportResult(db, io, req.identity.beeId, req.params.code as string, parsed.data);
      res.json(result);
    } catch (e: any) {
      const status = e.statusCode ?? 500;
      res.status(status).json({ error: e.message });
    }
  });

  router.patch("/tasks/:code/status", auth, requireOperator, (req, res) => {
    const { status: newStatus } = req.body;
    if (!newStatus || !["pending", "in_progress", "completed", "blocked", "failed", "cancelled"].includes(newStatus)) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "status inválido" });
      return;
    }
    const info = db.prepare(
      "UPDATE tasks SET status = ?, rev = rev + 1, updated_at = datetime('now') WHERE code = ?",
    ).run(newStatus, req.params.code as string);
    if (info.changes === 0) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    const updated = db.prepare("SELECT * FROM tasks WHERE code = ?").get(req.params.code as string);
    res.json(updated);
  });

  router.post("/integrations", auth, requireOperator, (req, res) => {
    if (!req.identity) return;
    const parsed = req.body;
    if (!parsed.target_branch || !COMMIT_RE.test(parsed.commit_sha || "")) {
      res.status(400).json({ error: "VALIDATION_ERROR", message: "target_branch requerido, commit_sha debe ser hex 7-40" });
      return;
    }
    // TODO Etapa 3: ejecutar git merge/cherry-pick
    const info = db.prepare(
      `INSERT INTO integrations (bee_id, task_id, covered_tasks, commit_sha, target_branch, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
    ).run(
      req.identity.beeId,
      parsed.task_id ?? null,
      parsed.covered_tasks ? JSON.stringify(parsed.covered_tasks) : null,
      parsed.commit_sha,
      parsed.target_branch,
    );
    const row = db.prepare("SELECT * FROM integrations WHERE id = ?").get(Number(info.lastInsertRowid));
    res.status(201).json(row);
  });

  router.get("/integrations", auth, (_req, res) => {
    const rows = db.prepare("SELECT * FROM integrations ORDER BY id").all();
    res.json(rows);
  });

  router.patch("/integrations/:id/resolve", auth, requireOperator, (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare("SELECT * FROM integrations WHERE id = ?").get(id) as any;
    if (!row) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    db.prepare("UPDATE integrations SET status = 'success', resolved_at = datetime('now') WHERE id = ?").run(id);
    const updated = db.prepare("SELECT * FROM integrations WHERE id = ?").get(id);
    res.json(updated);
  });

  router.get("/events", auth, (req, res) => {
    const since = Number(req.query.since) || 0;
    const rows = db.prepare("SELECT * FROM events WHERE id > ? ORDER BY id").all(since);
    res.json(rows);
  });
}
