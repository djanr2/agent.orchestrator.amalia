import type { Command } from "commander";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { findRoot, readConfig, pidPath } from "../config.js";

export function registerStop(program: Command): void {
  program
    .command("stop")
    .description("Stop the orchestrator API server")
    .action(() => {
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: .amalia-root not found"); process.exit(1); }
      const config = readConfig(root);
      const pidFile = pidPath(root, config);

      if (!existsSync(pidFile)) {
        console.error("Error: the server doesn't seem to be running (no api.pid)");
        process.exit(1);
      }

      const pid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        console.error(`Error: could not stop process ${pid}`);
        process.exit(1);
      }
      unlinkSync(pidFile);
      console.log(`✓ API (PID ${pid}) stopped`);
    });
}
