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

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

/** Envuelve la URL en un hyperlink OSC 8: clicable en terminales que lo soportan
 *  (Windows Terminal, iTerm2, VS Code...); en el resto se ve igual que texto plano. */
function terminalLink(url: string): string {
  return ESC + "]8;;" + url + BEL + url + ESC + "]8;;" + BEL;
}

function printDashboardUrl(port: number, staticDirExists: boolean): void {
  const url = `http://127.0.0.1:${port}/`;
  if (staticDirExists) {
    console.log(`  Dashboard: ${terminalLink(url)}`);
  } else {
    console.log(`  Dashboard no disponible (no se encontró la carpeta dashboard/)`);
  }
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

      const port = parseInt(opts.port, 10);
      const dashboardDir = join(PACKAGE_ROOT, "dashboard");
      const staticDirExists = existsSync(dashboardDir);

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
        printDashboardUrl(port, staticDirExists);
        console.log(`  Logs: ${logPath}`);
        console.log(`  Detener con: amalia stop`);
        printTokenInfo(root, config);
        return;
      }

      const staticDir = staticDirExists ? dashboardDir : undefined;
      const server = createServer({ db, port, staticDir });
      await server.listen(port);

      const pid = String(process.pid);
      writeFileSync(pidPath(root, config), pid, "utf8");

      console.log(`✓ API escuchando en ${terminalLink(`http://127.0.0.1:${port}/api/orchestrator`)}`);
      printDashboardUrl(port, staticDirExists);
      console.log(`  PID ${pid}`);
      printTokenInfo(root, config);

      process.on("SIGINT", () => { server.close(); process.exit(0); });
      process.on("SIGTERM", () => { server.close(); process.exit(0); });
    });
}
