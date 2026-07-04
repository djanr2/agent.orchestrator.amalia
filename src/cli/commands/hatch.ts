import type { Command } from "commander";
import { readFileSync, writeFileSync, chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findRoot, readConfig, secretsDir, beeWorktree, dbPath } from "../config.js";
import { validateBeeName } from "../../shared/validation.js";
import { generateToken, hashToken } from "../../api/auth.js";
import { openDb } from "../../db/index.js";
import { worktreeAdd } from "../git.js";
import { renderTemplate, defaultApiBaseUrl } from "../templates.js";

const PACKAGE_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");

const START_COMMANDS: Record<string, string> = {
  "claude-code": "claude -p --allowedTools Read,Edit,Write,Bash --permission-mode acceptEdits",
  opencode: "opencode run --auto",
  "copilot-cli": "gh copilot suggest -t shell",
  "codex-cli": "codex exec",
  ollama: "",
  custom: "",
};

function defaultStartCommand(engine: string): string {
  return START_COMMANDS[engine] ?? "";
}

function defaultModel(engine: string): string {
  if (engine === "ollama") return "llama3";
  if (engine === "claude-code") return "claude-sonnet-4-6";
  if (engine === "opencode") return "opencode/big-pickle";
  return "";
}

export function registerHatch(program: Command): void {
  program
    .command("hatch")
    .description("Create a new bee in the hive")
    .argument("<name>", "Bee name (e.g. database-bee)")
    .option("--engine <engine>", "Bee engine (opencode, claude-code, etc.)", "opencode")
    .option("--branch <branch>", "Branch for the bee's worktree")
    .option("--role <role>", "Role description")
    .action(async (name: string, opts: { engine: string; branch?: string; role?: string }) => {
      if (!validateBeeName(name)) {
        console.error("Error: invalid bee name (must look like: database-bee)"); process.exit(1);
      }

      const root = findRoot(process.cwd());
      if (!root) { console.error("Error: .amalia-root not found"); process.exit(1); }
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
          console.error("Error: a bee with that name already exists");
        } else {
          console.error(`Error creating bee in DB: ${e.message}`);
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
          // Roll back: the DB row and token were already created, but without a
          // real worktree the bee would be left in an inconsistent state.
          try { rmSync(tokenPath, { force: true }); } catch { /* ignore */ }
          const cleanupDb = openDb(dbPath(root, config));
          try { cleanupDb.prepare("DELETE FROM bees WHERE name = ?").run(name); } catch { /* ignore */ }
          cleanupDb.close();
          console.error(`Error creating worktree for '${name}': ${e.message}`);
          process.exit(1);
        }
      }

      const tmpl = join(PACKAGE_ROOT, "templates");
      const vars: Record<string, string> = {
        name,
        engine: opts.engine,
        role: opts.role ?? "",
        connection_mode: "cli",
        model: defaultModel(opts.engine),
        start_command: defaultStartCommand(opts.engine),
        endpoint: "",
        auth_env: "",
        api_base_url: defaultApiBaseUrl(),
        heartbeat_seconds: "60",
      };
      for (const f of ["bee.md", "AGENTS.md"]) {
        const src = join(tmpl, f);
        if (existsSync(src) && !existsSync(join(beeDir, f))) {
          writeFileSync(join(beeDir, f), renderTemplate(readFileSync(src, "utf8"), vars));
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

      console.log(`✓ Bee ${name} created`);
      console.log(`  Token: ${beeToken.slice(0, 12)}...`);
    });
}
