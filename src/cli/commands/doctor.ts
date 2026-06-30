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
    .description("Diagnose and repair the hive")
    .action(async () => {
      let ok = true;

      const root = findRoot(process.cwd());
      if (!root) { console.error("✗ .amalia-root not found"); process.exit(1); }
      const config = readConfig(root);

      try {
        const ver = await gitVersion();
        console.log(`✓ Git: ${ver}`);
      } catch {
        console.error("✗ Git unavailable"); ok = false;
      }

      const inside = await isInsideWorkTree(root);
      console.log(inside ? "✓ Inside a Git repo" : "✗ Outside a Git repo");
      if (!inside) ok = false;

      const branch = await currentBranch(root);
      console.log(`✓ Current branch: ${branch}`);

      const hasGitignore = checkGitignore(root, config.honeycomb_path);
      console.log(hasGitignore ? "✓ Amalia .gitignore block present" : "✗ Missing Amalia block in .gitignore");

      const dbFile = dbPath(root, config);
      if (existsSync(dbFile)) {
        const db = openDb(dbFile);
        const v = getSchemaVersion(db);
        console.log(`✓ Database: schema v${v}`);
        if (v !== 1) {
          console.log("  Applying migrations...");
          migrate(db);
          console.log("  ✓ Migrations applied");
        }
      } else {
        console.log("✗ Database not found");
        ok = false;
      }

      const aDir = amaliaWorktree(root, config);
      console.log(existsSync(aDir) ? `✓ Amalia worktree: ${aDir}` : "✗ Amalia worktree not found");

      if (ok) console.log("\n✓ Diagnosis complete: all OK");
      else { console.log("\n✗ Problems found. Review the messages above."); process.exit(1); }
    });
}
