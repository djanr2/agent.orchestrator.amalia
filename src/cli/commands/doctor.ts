import type { Command } from "commander";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findRoot, readConfig, amaliaWorktree, dbPath } from "../config.js";
import { openDb, getSchemaVersion } from "../../db/index.js";
import { migrate } from "../../db/migrate.js";
import { checkGitignore } from "../gitignore.js";
import { gitVersion, isInsideWorkTree, currentBranch } from "../git.js";

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Diagnosticar y reparar el panal")
    .action(async () => {
      let ok = true;

      const root = findRoot(process.cwd());
      if (!root) { console.error("✗ No se encontró .amalia-root"); process.exit(1); }
      const config = readConfig(root);

      try {
        const ver = await gitVersion();
        console.log(`✓ Git: ${ver}`);
      } catch {
        console.error("✗ Git no disponible"); ok = false;
      }

      const inside = await isInsideWorkTree(root);
      console.log(inside ? "✓ Dentro de un repo Git" : "✗ Fuera de un repo Git");
      if (!inside) ok = false;

      const branch = await currentBranch(root);
      console.log(`✓ Rama actual: ${branch}`);

      const hasGitignore = checkGitignore(root, config.honeycomb_path);
      console.log(hasGitignore ? "✓ .gitignore bloque Amalia presente" : "✗ Falta bloque Amalia en .gitignore");

      const dbFile = dbPath(root, config);
      if (existsSync(dbFile)) {
        const db = openDb(dbFile);
        const v = getSchemaVersion(db);
        console.log(`✓ Base de datos: schema v${v}`);
        if (v !== 1) {
          console.log("  Aplicando migraciones...");
          migrate(db);
          console.log("  ✓ Migraciones aplicadas");
        }
      } else {
        console.log("✗ Base de datos no encontrada");
        ok = false;
      }

      const aDir = amaliaWorktree(root, config);
      console.log(existsSync(aDir) ? `✓ Worktree Amalia: ${aDir}` : "✗ Worktree Amalia no encontrado");

      if (ok) console.log("\n✓ Diagnóstico completo: todo OK");
      else { console.log("\n✗ Se encontraron problemas. Revisa los mensajes arriba."); process.exit(1); }
    });
}
