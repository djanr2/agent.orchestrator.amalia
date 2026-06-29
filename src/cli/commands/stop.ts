import type { Command } from "commander";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { findRoot, readConfig, pidPath } from "../config.js";

export function registerStop(program: Command): void {
  program
    .command("stop")
    .description("Detener el servidor API del orquestador")
    .action(() => {
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: no se encontró .amalia-root"); process.exit(1); }
      const config = readConfig(root);
      const pidFile = pidPath(root, config);

      if (!existsSync(pidFile)) {
        console.error("Error: el servidor no parece estar corriendo (no hay api.pid)");
        process.exit(1);
      }

      const pid = parseInt(readFileSync(pidFile, "utf8").trim(), 10);
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        console.error(`Error: no se pudo detener el proceso ${pid}`);
        process.exit(1);
      }
      unlinkSync(pidFile);
      console.log(`✓ API (PID ${pid}) detenido`);
    });
}
