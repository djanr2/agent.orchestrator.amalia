import type { Command } from "commander";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../../db/index.js";
import { getSchemaVersion } from "../../db/index.js";
import { SCHEMA_VERSION } from "../../shared/types.js";
import { createServer } from "../../api/server.js";
import { findRoot, readConfig, dbPath, pidPath } from "../config.js";

const PACKAGE_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

function defaultPort(): number {
  const env = process.env.AMALIA_PORT;
  if (env) return parseInt(env, 10);
  return 4000;
}

export function registerStart(program: Command): void {
  program
    .command("start")
    .description("Levantar el servidor API del orquestador")
    .option("-p, --port <port>", `Puerto (default: ${defaultPort()}, env: AMALIA_PORT)`, String(defaultPort()))
    .action(async (opts: { port: string }) => {
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: no se encontró .amalia-root"); process.exit(1); }
      const config = readConfig(root);

      const db = openDb(dbPath(root, config));
      const v = getSchemaVersion(db);
      if (v !== SCHEMA_VERSION) {
        console.error(`Error: esquema desactualizado (v${v}), corre \`amalia doctor\``);
        process.exit(1);
      }

      const dashboardDir = join(PACKAGE_ROOT, "dashboard");
      const staticDir = existsSync(dashboardDir) ? dashboardDir : undefined;

      const port = parseInt(opts.port, 10);
      const server = createServer({ db, port, staticDir });
      await server.listen(port);

      const pid = String(process.pid);
      writeFileSync(pidPath(root, config), pid, "utf8");

      console.log(`✓ API escuchando en http://127.0.0.1:${port}/api/orchestrator`);
      if (staticDir) console.log(`  Dashboard: http://127.0.0.1:${port}/`);
      console.log(`  PID ${pid}`);

      process.on("SIGINT", () => { server.close(); process.exit(0); });
      process.on("SIGTERM", () => { server.close(); process.exit(0); });
    });
}
