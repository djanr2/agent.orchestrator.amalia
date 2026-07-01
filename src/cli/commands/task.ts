import type { Command } from "commander";
import { findRoot, readConfig, beeWorktree } from "../config.js";
import { writeTaskFile, upsertTasksSummary } from "../replica.js";
import { apiBaseUrl, operatorToken } from "../api.js";

export function registerTask(program: Command): void {
  const task = program
    .command("task")
    .description("Manage tasks");

  task
    .command("add")
    .description("Create a new task")
    .argument("<bee>", "Assigned bee")
    .argument("<description>", "Task description")
    .option("--priority <priority>", "Priority (high/medium/low)", "medium")
    .option("--depends-on <codes>", "Codes of tasks this depends on (comma-separated)")
    .option("--slug <slug>", "Slug (derived from the description by default)")
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
        console.log(`✓ Task ${created.code} created (${created.status})`);

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
        console.error(`Error: ${e.message ?? "Could not connect to the API"}`);
        process.exit(1);
      }
    });

  task
    .command("list")
    .description("List tasks")
    .option("--status <status>", "Filter by status")
    .option("--bee <bee>", "Filter by bee")
    .action(async (opts: { status?: string; bee?: string }) => {
      try {
        const token = operatorToken();
        const base = apiBaseUrl();
        const params = new URLSearchParams();
        if (opts.status) params.set("status", opts.status);
        if (opts.bee) params.set("assigned_to", opts.bee);

        const res = await fetch(`${base}/tasks?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) { console.error("Error listing tasks"); process.exit(1); }

        const tasks: any[] = await res.json();
        if (tasks.length === 0) { console.log("No tasks"); return; }

        console.log("Code         | Slug                          | Status        | Priority  | Rev");
        console.log("--------------|-------------------------------|---------------|-----------|-----");
        for (const t of tasks) {
          console.log(`${t.code.padEnd(12)} | ${(t.slug ?? "").padEnd(30)} | ${(t.status ?? "").padEnd(13)} | ${(t.priority ?? "").padEnd(9)} | ${t.rev}`);
        }
      } catch (e: any) {
        console.error(`Error: ${e.message ?? "Could not connect to the API"}`);
        process.exit(1);
      }
    });

  task
    .command("retry")
    .description("Move a blocked/failed task back to pending, resetting attempts")
    .argument("<code>", "Task code (TASK-XX)")
    .action(async (code: string) => {
      try {
        const token = operatorToken();
        const base = apiBaseUrl();
        const res = await fetch(`${base}/tasks/${code}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ status: "pending" }),
        });

        if (!res.ok) {
          const err = await res.json();
          console.error(`Error: ${err.error} — ${err.message ?? ""}`); process.exit(1);
        }

        const updated = await res.json();
        console.log(`✓ Task ${updated.code} set to pending (attempts reset)`);
      } catch (e: any) {
        console.error(`Error: ${e.message ?? "Could not connect to the API"}`);
        process.exit(1);
      }
    });

  task
    .command("show")
    .description("Show task detail")
    .argument("<code>", "Task code (TASK-XX)")
    .action(async (code: string) => {
      try {
        const token = operatorToken();
        const base = apiBaseUrl();
        const res = await fetch(`${base}/tasks/${code}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) { console.error("Task not found"); process.exit(1); }

        const t = await res.json();
        console.log(`Code:      ${t.code}`);
        console.log(`Slug:      ${t.slug}`);
        console.log(`Status:    ${t.status}`);
        console.log(`Priority:  ${t.priority}`);
        console.log(`Assigned:  ${t.assigned_to}`);
        console.log(`Desc:      ${t.description}`);
        console.log(`Rev:       ${t.rev}`);
        if (t.block_reason) console.log(`Blocked:   ${t.block_reason}`);
      } catch (e: any) {
        console.error(`Error: ${e.message ?? "Could not connect to the API"}`);
        process.exit(1);
      }
    });
}
