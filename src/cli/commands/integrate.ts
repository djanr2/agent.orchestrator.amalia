import type { Command } from "commander";
import { join } from "node:path";
import { findRoot, readConfig } from "../config.js";
import { statusPorcelain, mergeNoFf, cherryPick, hasConflicts } from "../git.js";
import { validateBeeName, validateCommitSha } from "../../shared/validation.js";

export function registerIntegrate(program: Command): void {
  const integrate = program
    .command("integrate")
    .description("Integrar trabajo de un bee en el worktree de Amalia");

  integrate
    .command("merge")
    .description("Integrar rama completa de un bee")
    .argument("<bee>", "Nombre del bee")
    .action(async (bee: string) => {
      if (!validateBeeName(bee)) { console.error("Error: nombre de bee inválido"); process.exit(1); }
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: no se encontró .amalia-root"); process.exit(1); }
      const config = readConfig(root);

      const amaliaDir = join(root, config.honeycomb_path, "amalia");
      const status = await statusPorcelain(amaliaDir);
      if (status) { console.error("Error: el worktree de Amalia no está limpio"); process.exit(1); }

      const beeBranch = `bee/${bee}`;
      const r = await mergeNoFf(amaliaDir, beeBranch);

      if (r.code !== 0) {
        if (await hasConflicts(amaliaDir)) {
          console.error("Conflicto durante merge. Resuelve manualmente y confirma.");
        } else {
          console.error(`Error: ${r.stderr}`);
        }
        process.exit(1);
      }

      console.log(`✓ Rama ${beeBranch} integrada en Amalia`);
    });

  integrate
    .command("cherry-pick")
    .description("Integrar un commit específico de un bee")
    .argument("<bee>", "Nombre del bee")
    .argument("<sha>", "SHA del commit")
    .action(async (bee: string, sha: string) => {
      if (!validateBeeName(bee)) { console.error("Error: nombre de bee inválido"); process.exit(1); }
      if (!validateCommitSha(sha)) { console.error("Error: SHA inválido"); process.exit(1); }
      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: no se encontró .amalia-root"); process.exit(1); }
      const config = readConfig(root);

      const amaliaDir = join(root, config.honeycomb_path, "amalia");
      const r = await cherryPick(amaliaDir, sha);

      if (r.code !== 0) {
        if (await hasConflicts(amaliaDir)) {
          console.error("Conflicto durante cherry-pick. Resuelve manualmente y corre `git cherry-pick --continue`");
        } else {
          console.error(`Error: ${r.stderr}`);
        }
        process.exit(1);
      }

      console.log(`✓ Commit ${sha.slice(0, 8)} integrado en Amalia`);
    });
}
