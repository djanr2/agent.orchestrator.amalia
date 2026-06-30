import type { Command } from "commander";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { findRoot, readConfig, secretsDir, beeWorktree } from "../config.js";
import { apiBaseUrl } from "../api.js";

export function registerLogs(program: Command): void {
  program
    .command("logs")
    .description("Show a bee's results and events")
    .argument("<bee>", "Bee name")
    .action(async (bee: string) => {
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: .amalia-root not found"); process.exit(1); }
      const config = readConfig(root);

      const tokenPath = join(secretsDir(root, config), "amalia.token");
      const token = readFileSync(tokenPath, "utf8").trim();

      try {
        const eventsRes = await fetch(`${apiBaseUrl()}/events?bee=${bee}`, { headers: { Authorization: `Bearer ${token}` } });
        if (eventsRes.ok) {
          const events: any[] = await eventsRes.json();
          console.log(`Recent events for ${bee}:`);
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
          console.log("No local results and API unavailable");
        }
      }
    });
}
