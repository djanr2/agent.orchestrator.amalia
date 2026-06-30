import type { Command } from "commander";
import { join } from "node:path";
import { findRoot, readConfig } from "../config.js";
import { statusPorcelain, mergeNoFf, cherryPick, hasConflicts } from "../git.js";
import { validateBeeName, validateCommitSha } from "../../shared/validation.js";

export function registerIntegrate(program: Command): void {
  const integrate = program
    .command("integrate")
    .description("Integrate a bee's work into the Amalia worktree");

  integrate
    .command("merge")
    .description("Integrate a bee's full branch")
    .argument("<bee>", "Bee name")
    .action(async (bee: string) => {
      if (!validateBeeName(bee)) { console.error("Error: invalid bee name"); process.exit(1); }
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: .amalia-root not found"); process.exit(1); }
      const config = readConfig(root);

      const amaliaDir = join(root, config.honeycomb_path, "amalia");
      const status = await statusPorcelain(amaliaDir);
      if (status) { console.error("Error: the Amalia worktree is not clean"); process.exit(1); }

      const beeBranch = `bee/${bee}`;
      const r = await mergeNoFf(amaliaDir, beeBranch);

      if (r.code !== 0) {
        if (await hasConflicts(amaliaDir)) {
          console.error("Conflict during merge. Resolve manually and commit.");
        } else {
          console.error(`Error: ${r.stderr}`);
        }
        process.exit(1);
      }

      console.log(`✓ Branch ${beeBranch} integrated into Amalia`);
    });

  integrate
    .command("cherry-pick")
    .description("Integrate a specific commit from a bee")
    .argument("<bee>", "Bee name")
    .argument("<sha>", "Commit SHA")
    .action(async (bee: string, sha: string) => {
      if (!validateBeeName(bee)) { console.error("Error: invalid bee name"); process.exit(1); }
      if (!validateCommitSha(sha)) { console.error("Error: invalid SHA"); process.exit(1); }
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: .amalia-root not found"); process.exit(1); }
      const config = readConfig(root);

      const amaliaDir = join(root, config.honeycomb_path, "amalia");
      const r = await cherryPick(amaliaDir, sha);

      if (r.code !== 0) {
        if (await hasConflicts(amaliaDir)) {
          console.error("Conflict during cherry-pick. Resolve manually and run `git cherry-pick --continue`");
        } else {
          console.error(`Error: ${r.stderr}`);
        }
        process.exit(1);
      }

      console.log(`✓ Commit ${sha.slice(0, 8)} integrated into Amalia`);
    });
}
