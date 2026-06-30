import type { Command } from "commander";
import { findRoot, readConfig, writeConfig, amaliaWorktree } from "../config.js";
import { currentBranch, fetch, rebase, hasConflicts, rebaseAbort } from "../git.js";

export function registerUpdate(program: Command): void {
  program
    .command("update")
    .description("Update the Amalia worktree against the target branch")
    .action(async () => {
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: .amalia-root not found"); process.exit(1); }
      const config = readConfig(root);

      const repoBranch = await currentBranch(root);
      if (repoBranch !== config.target_branch) {
        console.log(`Note: repo branch changed from ${config.target_branch} to ${repoBranch}`);
        writeConfig(root, { ...config, target_branch: repoBranch });
        console.log(`  .amalia-root updated`);
      }

      await fetch(root);

      const aDir = amaliaWorktree(root, config);
      const r = await rebase(aDir, config.target_branch);

      if (r.code !== 0) {
        const conflicts = await hasConflicts(aDir);
        if (conflicts) {
          await rebaseAbort(aDir);
          console.error("Error: conflict during rebase. Automatically aborted.");
          console.error("  Resolve the conflicts manually and run `amalia integrate`");
          process.exit(1);
        }
        console.error(`Error during rebase: ${r.stderr}`);
        process.exit(1);
      }

      console.log(`✓ Amalia worktree updated against ${config.target_branch}`);
    });
}
