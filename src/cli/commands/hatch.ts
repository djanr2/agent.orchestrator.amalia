import type { Command } from "commander";
import { readFileSync, writeFileSync, chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRoot, readConfig, secretsDir, beeWorktree, dbPath } from "../config.js";
import { validateBeeName } from "../../shared/validation.js";
import { generateToken, hashToken } from "../../api/auth.js";
import { openDb } from "../../db/index.js";
import { worktreeAdd } from "../git.js";

const PACKAGE_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

export function registerHatch(program: Command): void {
  program
    .command("hatch")
    .description("Crear un nuevo bee en el panal")
    .argument("<name>", "Nombre del bee (ej: database-bee)")
    .option("--engine <engine>", "Motor del bee (opencode, claude-code, etc.)", "opencode")
    .option("--branch <branch>", "Rama del worktree del bee")
    .option("--role <role>", "Descripción del rol")
    .action(async (name: string, opts: { engine: string; branch?: string; role?: string }) => {
      if (!validateBeeName(name)) {
        console.error("Error: nombre de bee inválido (debe ser ej: database-bee)"); process.exit(1);
      }

      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: no se encontró .amalia-root"); process.exit(1); }
      const config = readConfig(root);

      const beeToken = generateToken();
      const beeDir = beeWorktree(root, config, name);
      const tokenPath = join(secretsDir(root, config), `${name}.token`);

      const db = openDb(dbPath(root, config));
      try {
        db.prepare(
          "INSERT INTO bees (name, worktree_path, engine, connection_mode, token_hash, status) VALUES (?, ?, ?, ?, ?, 'idle')",
        ).run(name, beeDir, opts.engine, "cli", hashToken(beeToken));
      } catch (e: any) {
        if (e.message?.includes("UNIQUE")) {
          console.error("Error: ya existe un bee con ese nombre");
        } else {
          console.error(`Error al crear bee en DB: ${e.message}`);
        }
        db.close();
        process.exit(1);
      }
      db.close();

      if (!existsSync(secretsDir(root, config))) mkdirSync(secretsDir(root, config), { recursive: true });
      writeFileSync(tokenPath, beeToken, "utf8");
      try { chmodSync(tokenPath, 0o600); } catch { }

      if (!existsSync(beeDir)) {
        const branch = opts.branch ?? `bee/${name}`;
        try {
          await worktreeAdd(root, beeDir, branch);
        } catch (e: any) {
          // Revertir: la fila en DB y el token ya se crearon, pero sin worktree
          // real el bee queda en un estado inconsistente.
          try { rmSync(tokenPath, { force: true }); } catch { /* ignore */ }
          const cleanupDb = openDb(dbPath(root, config));
          try { cleanupDb.prepare("DELETE FROM bees WHERE name = ?").run(name); } catch { /* ignore */ }
          cleanupDb.close();
          console.error(`Error al crear worktree para '${name}': ${e.message}`);
          process.exit(1);
        }
      }

      const tmpl = join(PACKAGE_ROOT, "templates");
      for (const f of ["bee.md", "AGENTS.md"]) {
        const src = join(tmpl, f);
        if (existsSync(src) && !existsSync(join(beeDir, f))) {
          writeFileSync(join(beeDir, f), readFileSync(src, "utf8"));
        }
      }
      const tasksDir = join(beeDir, "tasks");
      if (!existsSync(tasksDir)) {
        mkdirSync(tasksDir, { recursive: true });
        for (const f of ["tasks.md", "results.md"]) {
          const src = join(tmpl, "tasks", f);
          if (existsSync(src)) writeFileSync(join(tasksDir, f), readFileSync(src, "utf8"));
        }
      }

      console.log(`✓ Bee ${name} creado`);
      console.log(`  Token: ${beeToken.slice(0, 12)}...`);
    });
}
