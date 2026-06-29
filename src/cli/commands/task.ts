import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findRoot, readConfig, secretsDir, beeWorktree } from "../config.js";
import { writeTaskFile, upsertTasksSummary } from "../replica.js";
import { apiBaseUrl, operatorToken } from "../api.js";

export function registerTask(program: Command): void {
  const task = program
    .command("task")
    .description("Gestionar tareas");

  task
    .command("add")
    .description("Crear nueva tarea")
    .argument("<bee>", "Bee asignado")
    .argument("<description>", "Descripción de la tarea")
    .option("--priority <priority>", "Prioridad (high/medium/low)", "medium")
    .option("--depends-on <codes>", "Códigos de tareas de las que depende (coma separados)")
    .option("--slug <slug>", "Slug (por defecto se deriva de la descripción)")
    .action(async (beeName: string, description: string, opts: { priority: string; dependsOn?: string; slug?: string }) => {
      try {
        const token = operatorToken();
        const slug = opts.slug ?? description.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
        const dependsOn = opts.dependsOn ? opts.dependsOn.split(",").map((s: string) => s.trim()).filter(Boolean) : [];

        const base = apiBaseUrl();
        const res = await fetch(`${base}/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ assigned_to: beeName, description, priority: opts.priority, slug, depends_on: dependsOn, max_attempts: 3 }),
        });

        if (!res.ok) {
          const err = await res.json();
          console.error(`Error: ${err.error} — ${err.message ?? ""}`); process.exit(1);
        }

        const created = await res.json();
        console.log(`✓ Tarea ${created.code} creada (${created.status})`);

        const root = findRoot(process.cwd())!;
        const config = readConfig(root);
        const beeDir = beeWorktree(root, config, beeName);

        writeTaskFile(beeDir, { ...created, beeName });

        const allRes = await fetch(`${base}/tasks?assigned_to=${beeName}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const allTasks: any[] = allRes.ok ? await allRes.json() : [created];
        upsertTasksSummary(beeDir, allTasks.map((t: any) => ({ ...t, beeName })));
      } catch (e: any) {
        console.error(`Error: ${e.message ?? "No se pudo conectar con la API"}`);
        process.exit(1);
      }
    });

  task
    .command("list")
    .description("Listar tareas")
    .option("--status <status>", "Filtrar por estado")
    .option("--bee <bee>", "Filtrar por bee")
    .action(async (opts: { status?: string; bee?: string }) => {
      try {
        const token = operatorToken();
        const base = apiBaseUrl();
        const params = new URLSearchParams();
        if (opts.status) params.set("status", opts.status);
        if (opts.bee) params.set("assigned_to", opts.bee);

        const res = await fetch(`${base}/tasks?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) { console.error("Error al listar tareas"); process.exit(1); }

        const tasks: any[] = await res.json();
        if (tasks.length === 0) { console.log("No hay tareas"); return; }

        console.log("Código       | Slug                          | Estado        | Prioridad | Rev");
        console.log("--------------|-------------------------------|---------------|-----------|-----");
        for (const t of tasks) {
          console.log(`${t.code.padEnd(12)} | ${(t.slug ?? "").padEnd(30)} | ${(t.status ?? "").padEnd(13)} | ${(t.priority ?? "").padEnd(9)} | ${t.rev}`);
        }
      } catch (e: any) {
        console.error(`Error: ${e.message ?? "No se pudo conectar con la API"}`);
        process.exit(1);
      }
    });

  task
    .command("show")
    .description("Mostrar detalle de una tarea")
    .argument("<code>", "Código de la tarea (TASK-XX)")
    .action(async (code: string) => {
      try {
        const token = operatorToken();
        const base = apiBaseUrl();
        const res = await fetch(`${base}/tasks/${code}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) { console.error("Tarea no encontrada"); process.exit(1); }

        const t = await res.json();
        console.log(`Código:    ${t.code}`);
        console.log(`Slug:      ${t.slug}`);
        console.log(`Estado:    ${t.status}`);
        console.log(`Prioridad: ${t.priority}`);
        console.log(`Asignado:  ${t.assigned_to}`);
        console.log(`Desc:      ${t.description}`);
        console.log(`Rev:       ${t.rev}`);
        if (t.block_reason) console.log(`Bloqueo:   ${t.block_reason}`);
      } catch (e: any) {
        console.error(`Error: ${e.message ?? "No se pudo conectar con la API"}`);
        process.exit(1);
      }
    });
}
