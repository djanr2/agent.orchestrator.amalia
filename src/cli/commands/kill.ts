import type { Command } from "commander";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { findRoot, readConfig, secretsDir, beeWorktree, dbPath } from "../config.js";
import { validateBeeName } from "../../shared/validation.js";
import { openDb } from "../../db/index.js";
import { cherry, worktreeRemove } from "../git.js";

export function registerKill(program: Command): void {
  program
    .command("kill")
    .description("Remove a bee from the hive")
    .argument("<name>", "Bee name")
    .option("--force", "Force removal even if there is unintegrated work")
    .option("--reassign-to <bee>", "Reassign pending tasks to another bee")
    .action(async (name: string, opts: { force?: boolean; reassignTo?: string }) => {
      if (name === "amalia") {
        console.error("👑 You can't kill the Queen 👑");
        process.exit(1);
      }
      if (!validateBeeName(name)) {
        console.error("Error: invalid bee name"); process.exit(1);
      }

      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: .amalia-root not found"); process.exit(1); }
      const config = readConfig(root);
      const beeDir = beeWorktree(root, config, name);

      const db = openDb(dbPath(root, config));
      const beeRow = db.prepare("SELECT id FROM bees WHERE name = ?").get(name) as { id: number } | undefined;
      if (!beeRow) {
        console.error(`Error: no bee named "${name}" exists in the database`);
        db.close(); process.exit(1);
      }
      const beeId = beeRow.id;

      const pending = db.prepare("SELECT code, status FROM tasks WHERE assigned_to = ? AND status IN ('pending', 'in_progress')").all(beeId) as { code: string; status: string }[];

      if (pending.length > 0 && !opts.force && !opts.reassignTo) {
        console.error(`Error: this bee has ${pending.length} unfinished task(s):`);
        for (const t of pending) console.error(`  ${t.code} (${t.status})`);
        console.error("  Use --force to remove anyway, or --reassign-to <bee> to reassign");
        db.close(); process.exit(1);
      }

      if (opts.reassignTo) {
        const target = db.prepare("SELECT id FROM bees WHERE name = ?").get(opts.reassignTo) as { id: number } | undefined;
        if (!target) {
          console.error(`Error: bee "${opts.reassignTo}" does not exist`);
          db.close(); process.exit(1);
        }
        // Reassign ALL tasks (not just pending/in_progress): any row still pointing
        // to this bee as assigned_to would block the DELETE via foreign key.
        const info = db.prepare("UPDATE tasks SET assigned_to = ? WHERE assigned_to = ?").run(target.id, beeId);
        if (info.changes > 0) console.log(`  ${info.changes} task(s) reassigned to ${opts.reassignTo}`);
      }

      const branch = `bee/${name}`;
      if (!opts.force) {
        const unpushed = await cherry(beeDir, config.target_branch, branch);
        if (unpushed) {
          console.error(`Error: there are unintegrated commits on ${branch}. Use --force to ignore`);
          db.close(); process.exit(1);
        }
      }

      await worktreeRemove(root, beeDir, !!opts.force);

      try {
        db.prepare("DELETE FROM bees WHERE id = ?").run(beeId);
      } catch (e: any) {
        db.close();
        console.error(`Error: could not remove "${name}" — it still has associated tasks/results.`);
        console.error(`  Use --reassign-to <bee> to transfer its history before removing it.`);
        process.exit(1);
      }

      const tokenPath = join(secretsDir(root, config), `${name}.token`);
      try { unlinkSync(tokenPath); } catch { }

      db.close();
      console.log(`✓ Bee ${name} removed`);
    });
}
