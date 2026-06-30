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
    .description("Eliminar un bee del panal")
    .argument("<name>", "Nombre del bee")
    .option("--force", "Forzar eliminación aunque haya trabajo sin integrar")
    .option("--reassign-to <bee>", "Reasignar tareas pendientes a otro bee")
    .action(async (name: string, opts: { force?: boolean; reassignTo?: string }) => {
      if (!validateBeeName(name)) {
        console.error("Error: nombre de bee inválido"); process.exit(1);
      }

      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: no se encontró .amalia-root"); process.exit(1); }
      const config = readConfig(root);
      const beeDir = beeWorktree(root, config, name);

      const db = openDb(dbPath(root, config));
      const beeRow = db.prepare("SELECT id FROM bees WHERE name = ?").get(name) as { id: number } | undefined;
      if (!beeRow) {
        console.error(`Error: no existe un bee llamado "${name}" en la base de datos`);
        db.close(); process.exit(1);
      }
      const beeId = beeRow.id;

      const pending = db.prepare("SELECT code, status FROM tasks WHERE assigned_to = ? AND status IN ('pending', 'in_progress')").all(beeId) as { code: string; status: string }[];

      if (pending.length > 0 && !opts.force && !opts.reassignTo) {
        console.error(`Error: el bee tiene ${pending.length} tareas sin completar:`);
        for (const t of pending) console.error(`  ${t.code} (${t.status})`);
        console.error("  Usa --force para eliminar de todas formas, o --reassign-to <bee> para reasignar");
        db.close(); process.exit(1);
      }

      if (opts.reassignTo) {
        const target = db.prepare("SELECT id FROM bees WHERE name = ?").get(opts.reassignTo) as { id: number } | undefined;
        if (!target) {
          console.error(`Error: no existe el bee "${opts.reassignTo}"`);
          db.close(); process.exit(1);
        }
        // Reasigna TODAS las tareas (no solo pending/in_progress): cualquier fila que
        // siga apuntando a este bee como assigned_to bloqueará el DELETE por foreign key.
        const info = db.prepare("UPDATE tasks SET assigned_to = ? WHERE assigned_to = ?").run(target.id, beeId);
        if (info.changes > 0) console.log(`  ${info.changes} tarea(s) reasignadas a ${opts.reassignTo}`);
      }

      const branch = `bee/${name}`;
      if (!opts.force) {
        const unpushed = await cherry(beeDir, config.target_branch, branch);
        if (unpushed) {
          console.error(`Error: hay commits sin integrar en ${branch}. Usa --force para ignorar`);
          db.close(); process.exit(1);
        }
      }

      await worktreeRemove(root, beeDir, !!opts.force);

      try {
        db.prepare("DELETE FROM bees WHERE id = ?").run(beeId);
      } catch (e: any) {
        db.close();
        console.error(`Error: no se pudo eliminar "${name}" — aún tiene tareas/resultados asociados.`);
        console.error(`  Usa --reassign-to <bee> para transferir su historial antes de eliminarlo.`);
        process.exit(1);
      }

      const tokenPath = join(secretsDir(root, config), `${name}.token`);
      try { unlinkSync(tokenPath); } catch { }

      db.close();
      console.log(`✓ Bee ${name} eliminado`);
    });
}
