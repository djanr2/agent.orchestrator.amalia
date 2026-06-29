import type { Command } from "commander";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { findRoot, readConfig, secretsDir, beeWorktree } from "../config.js";
import { apiBaseUrl } from "../api.js";

export function registerCheck(program: Command): void {
  program
    .command("check")
    .description("Ver estado de bees y tareas")
    .argument("[bee]", "Nombre del bee (opcional)")
    .action(async (bee?: string) => {
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: no se encontró .amalia-root"); process.exit(1); }
      const config = readConfig(root);

      try {
        const tokenPath = join(secretsDir(root, config), "amalia.token");
        const token = readFileSync(tokenPath, "utf8").trim();
        const res = await fetch(`${apiBaseUrl()}/bees`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const bees: any[] = await res.json();
          for (const b of bees) {
            if (bee && b.name !== bee) continue;
            console.log(`Bee: ${b.name} — ${b.status} (engine: ${b.engine})`);
          }
        }
      } catch {
        for (const entry of readdirSync(join(root, config.honeycomb_path))) {
          const bDir = beeWorktree(root, config, entry);
          if (existsSync(join(bDir, "bee.md"))) {
            if (bee && entry !== bee) continue;
            const tDir = join(bDir, "tasks");
            const files = existsSync(tDir) ? readdirSync(tDir).filter((f) => f.endsWith(".task.md")) : [];
            console.log(`Bee: ${entry} (local — API no disponible, ${files.length} tareas)`);
          }
        }
      }
    });
}
