import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findRoot, readConfig, secretsDir, beeWorktree } from "../config.js";
import { readTaskFile, writeTaskFile } from "../replica.js";
import { apiBaseUrl } from "../api.js";

export function registerSync(program: Command): void {
  program
    .command("sync")
    .description("Reconcile local files with the database")
    .action(async () => {
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: .amalia-root not found"); process.exit(1); }
      const config = readConfig(root);

      try {
        const tokenPath = join(secretsDir(root, config), "amalia.token");
        const token = readFileSync(tokenPath, "utf8").trim();
        const res = await fetch(`${apiBaseUrl()}/tasks`, { headers: { Authorization: `Bearer ${token}` } });

        if (res.ok) {
          const tasks: any[] = await res.json();
          const byBee = new Map<string, any[]>();
          for (const t of tasks) {
            const beeName = t.assigned_to_name ?? String(t.assigned_to);
            if (!byBee.has(beeName)) byBee.set(beeName, []);
            byBee.get(beeName)!.push(t);
          }

          for (const [beeName, beeTasks] of byBee) {
            const beeDir = beeWorktree(root, config, beeName);
            if (!existsSync(beeDir)) continue;
            for (const t of beeTasks) {
              const local = readTaskFile(beeDir, t.slug);
              if (!local || local.frontmatter.rev < t.rev) {
                writeTaskFile(beeDir, { ...t, beeName });
                console.log(`  Updated ${t.slug}.task.md (rev ${t.rev})`);
              }
              if (local && local.frontmatter.rev > t.rev) {
                console.log(`  Conflict: ${t.slug}.task.md has rev ${local.frontmatter.rev} > DB ${t.rev}`);
              }
            }
          }
        }
      } catch {
        console.log("API unavailable, cannot sync");
      }
    });
}
