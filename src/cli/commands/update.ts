import type { Command } from "commander";
import { findRoot, readConfig, writeConfig, amaliaWorktree } from "../config.js";
import { currentBranch, fetch, rebase, hasConflicts, rebaseAbort } from "../git.js";

export function registerUpdate(program: Command): void {
  program
    .command("update")
    .description("Actualizar el worktree de Amalia contra la rama objetivo")
    .action(async () => {
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: no se encontró .amalia-root"); process.exit(1); }
      const config = readConfig(root);

      const repoBranch = await currentBranch(root);
      if (repoBranch !== config.target_branch) {
        console.log(`Nota: la rama del repo cambió de ${config.target_branch} a ${repoBranch}`);
        writeConfig(root, { ...config, target_branch: repoBranch });
        console.log(`  .amalia-root actualizado`);
      }

      await fetch(root);

      const aDir = amaliaWorktree(root, config);
      const r = await rebase(aDir, config.target_branch);

      if (r.code !== 0) {
        const conflicts = await hasConflicts(aDir);
        if (conflicts) {
          await rebaseAbort(aDir);
          console.error("Error: conflicto durante el rebase. Se abortó automáticamente.");
          console.error("  Resuelve los conflictos manualmente y corre `amalia integrate`");
          process.exit(1);
        }
        console.error(`Error durante rebase: ${r.stderr}`);
        process.exit(1);
      }

      console.log(`✓ Worktree Amalia actualizado contra ${config.target_branch}`);
    });
}
