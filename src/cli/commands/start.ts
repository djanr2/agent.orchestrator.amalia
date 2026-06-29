import type { Command } from "commander";
import { writeFileSync, existsSync, readFileSync, openSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { openDb } from "../../db/index.js";
import { getSchemaVersion } from "../../db/index.js";
import { SCHEMA_VERSION } from "../../shared/types.js";
import { createServer } from "../../api/server.js";
import {
  findRoot,
  readConfig,
  dbPath,
  pidPath,
  secretsDir,
  orchestratorApiDir,
  type AmaliaConfig,
} from "../config.js";

const PACKAGE_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

function defaultPort(): number {
  const env = process.env.AMALIA_PORT;
  if (env) return parseInt(env, 10);
  return 4000;
}

function printTokenInfo(root: string, config: AmaliaConfig): void {
  const tokenPath = join(secretsDir(root, config), "amalia.token");
  if (existsSync(tokenPath)) {
    const token = readFileSync(tokenPath, "utf8").trim();
    console.log(`  Token operador: ${token}`);
  } else {
    console.log(`  Token operador no encontrado en ${tokenPath}`);
  }
  console.log(`  (guardado en ${tokenPath})`);
}

export function registerStart(program: Command): void {
  program
    .command("start")
    .description("Levantar el servidor API del orquestador")
    .option("-p, --port <port>", `Puerto (default: ${defaultPort()}, env: AMALIA_PORT)`, String(defaultPort()))
    .option("-d, --detach", "Correr en segundo plano (libera la terminal)")
    .action(async (opts: { port: string; detach?: boolean }) => {
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: no se encontró .amalia-root"); process.exit(1); }
      const config = readConfig(root);

      const db = openDb(dbPath(root, config));
      const v = getSchemaVersion(db);
      if (v !== SCHEMA_VERSION) {
        console.error(`Error: esquema desactualizado (v${v}), corre \`amalia doctor\``);
        process.exit(1);
      }

      if (opts.detach) {
        db.close();
        const logPath = join(orchestratorApiDir(root, config), "api.log");
        const out = openSync(logPath, "a");
        const err = openSync(logPath, "a");
        const child = spawn(
          process.execPath,
          [process.argv[1], "start", "--port", opts.port],
          { cwd: process.cwd(), detached: true, stdio: ["ignore", out, err] },
        );
        child.unref();
        writeFileSync(pidPath(root, config), String(child.pid), "utf8");
        console.log(`✓ API arrancando en segundo plano (PID ${child.pid})`);
        console.log(`  Logs: ${logPath}`);
        console.log(`  Detener con: amalia stop`);
        printTokenInfo(root, config);
        return;
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
      printTokenInfo(root, config);

      process.on("SIGINT", () => { server.close(); process.exit(0); });
      process.on("SIGTERM", () => { server.close(); process.exit(0); });
    });
}
