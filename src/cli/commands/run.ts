import type { Command } from "commander";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findRoot, readConfig, beeWorktree, secretsDir, type AmaliaConfig } from "../config.js";
import { defaultApiBaseUrl } from "../templates.js";
import { launchBee } from "../../engines/launch.js";

export interface RunTarget {
  beeDir: string;
  secretsDir: string;
  apiBaseUrl: string;
}

/** Resolves and validates the paths needed to run a bee. Throws a descriptive
 *  Error if the worktree or token are missing, instead of letting launchBee
 *  fail later with a less specific message. */
export function resolveRunTarget(root: string, config: AmaliaConfig, bee: string): RunTarget {
  const beeDir = beeWorktree(root, config, bee);
  if (!existsSync(beeDir)) {
    throw new Error(`worktree not found for '${bee}' at ${beeDir}`);
  }

  const secrets = secretsDir(root, config);
  if (!existsSync(join(secrets, `${bee}.token`))) {
    throw new Error(`token not found for '${bee}' in ${secrets}`);
  }

  return { beeDir, secretsDir: secrets, apiBaseUrl: defaultApiBaseUrl() };
}

export function registerRun(program: Command): void {
  program
    .command("run")
    .description("Run a bee's agent runtime (claims and executes its pending tasks)")
    .argument("<bee>", "Bee name")
    .option("--once", "Run a single claim-execute-report cycle and exit, instead of looping forever as a daemon")
    .action(async (bee: string, opts: { once?: boolean }) => {
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: .amalia-root not found"); process.exit(1); }
      const config = readConfig(root);

      let target: RunTarget;
      try {
        target = resolveRunTarget(root, config, bee);
      } catch (e: any) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }

      const stop = () => process.exit(0);
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);

      await launchBee({ ...target, once: opts.once }).catch((e: any) => {
        console.error("Fatal error:", e.message);
        process.exit(1);
      });

      // undici (fetch) keeps keep-alive sockets open, which would otherwise
      // hold the event loop alive indefinitely after a --once run completes.
      if (opts.once) process.exit(0);
    });
}
