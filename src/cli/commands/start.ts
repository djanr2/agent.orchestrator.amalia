import type { Command } from "commander";
import { writeFileSync, existsSync, readFileSync, openSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { openDb } from "../../db/index.js";
import { getSchemaVersion } from "../../db/index.js";
import { SCHEMA_VERSION } from "../../shared/types.js";
import { createServer } from "../../api/server.js";
import { startScheduler } from "../../api/jobs/scheduler.js";
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

/** Wraps the URL in an OSC 8 hyperlink: clickable in terminals that support it
 *  (Windows Terminal, iTerm2, VS Code...); plain text everywhere else. */
function terminalLink(url: string): string {
  return ESC + "]8;;" + url + BEL + url + ESC + "]8;;" + BEL;
}

function printDashboardUrl(port: number, staticDirExists: boolean): void {
  const url = `http://127.0.0.1:${port}/`;
  if (staticDirExists) {
    console.log(`  Dashboard: ${terminalLink(url)}`);
  } else {
    console.log(`  Dashboard unavailable (dashboard/ folder not found)`);
  }
}

function printTokenInfo(root: string, config: AmaliaConfig): void {
  const tokenPath = join(secretsDir(root, config), "amalia.token");
  if (existsSync(tokenPath)) {
    const token = readFileSync(tokenPath, "utf8").trim();
    console.log(`  Operator token: ${token}`);
  } else {
    console.log(`  Operator token not found at ${tokenPath}`);
  }
  console.log(`  (saved at ${tokenPath})`);
}

export function registerStart(program: Command): void {
  program
    .command("start")
    .description("Start the orchestrator API server")
    .option("-p, --port <port>", `Port (default: ${defaultPort()}, env: AMALIA_PORT)`, String(defaultPort()))
    .option("-d, --detach", "Run in the background (frees the terminal)")
    .action(async (opts: { port: string; detach?: boolean }) => {
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: .amalia-root not found"); process.exit(1); }
      const config = readConfig(root);

      const db = openDb(dbPath(root, config));
      const v = getSchemaVersion(db);
      if (v !== SCHEMA_VERSION) {
        console.error(`Error: schema out of date (v${v}), run \`amalia doctor\``);
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
        console.log(`✓ API starting in the background (PID ${child.pid})`);
        printDashboardUrl(port, staticDirExists);
        console.log(`  Logs: ${logPath}`);
        console.log(`  Stop with: amalia stop`);
        printTokenInfo(root, config);
        return;
      }

      const staticDir = staticDirExists ? dashboardDir : undefined;
      const server = createServer({ db, port, staticDir });
      await server.listen(port);

      const scheduler = startScheduler(db, server.io);

      const pid = String(process.pid);
      writeFileSync(pidPath(root, config), pid, "utf8");

      console.log(`✓ API listening on ${terminalLink(`http://127.0.0.1:${port}/api/orchestrator`)}`);
      printDashboardUrl(port, staticDirExists);
      console.log(`  PID ${pid}`);
      printTokenInfo(root, config);

      const shutdown = () => { scheduler.stop(); server.close(); process.exit(0); };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
}
