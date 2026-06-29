import type { Command } from "commander";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findRoot, readConfig, secretsDir, beeWorktree } from "../config.js";
import { apiBaseUrl } from "../api.js";

export function registerLogs(program: Command): void {
  program
    .command("logs")
    .description("Mostrar resultados y eventos de un bee")
    .argument("<bee>", "Nombre del bee")
    .action(async (bee: string) => {
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: no se encontró .amalia-root"); process.exit(1); }
      const config = readConfig(root);

      const tokenPath = join(secretsDir(root, config), "amalia.token");
      const token = readFileSync(tokenPath, "utf8").trim();

      try {
        const eventsRes = await fetch(`${apiBaseUrl()}/events?bee=${bee}`, { headers: { Authorization: `Bearer ${token}` } });
        if (eventsRes.ok) {
          const events: any[] = await eventsRes.json();
          console.log(`Eventos recientes de ${bee}:`);
          for (const e of events.slice(0, 20)) {
            console.log(`  [${e.created_at ?? ""}] ${e.type}: ${JSON.stringify(e.payload ?? {})}`);
          }
        }
      } catch {
        const beeDir = beeWorktree(root, config, bee);
        const resultsPath = join(beeDir, "tasks", "results.md");
        if (existsSync(resultsPath)) {
          console.log(readFileSync(resultsPath, "utf8"));
        } else {
          console.log("No hay resultados locales ni API disponible");
        }
      }
    });
}
