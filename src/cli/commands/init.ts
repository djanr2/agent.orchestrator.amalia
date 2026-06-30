import type { Command } from "commander";
import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, applySchema } from "../../db/index.js";
import { generateToken, hashToken } from "../../api/auth.js";
import { writeConfig, honeycombDir, orchestratorApiDir, secretsDir, dbPath, amaliaWorktree } from "../config.js";
import { ensureGitignore } from "../gitignore.js";
import { gitVersion, isInsideWorkTree, currentBranch, worktreeAdd } from "../git.js";
import { renderTemplate, defaultApiBaseUrl } from "../templates.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const PACKAGE_ROOT = join(here, "..", "..", "..");

interface CreatedState {
  dirs: string[];
  dbPath?: string;
  tokenPath?: string;
  configWritten?: boolean;
  gitignoreWritten?: boolean;
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize a new Amalia hive")
    .option("--honeycomb-path <path>", "Hive path", "honeycomb")
    .action(async (opts: { honeycombPath: string }) => {
      const rootDir = process.cwd();
      const honeyPath = opts.honeycombPath;
      const created: CreatedState = { dirs: [] };

      const cleanup = () => {
        for (const d of created.dirs.reverse()) {
          try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
        }
        if (created.tokenPath) { try { rmSync(created.tokenPath, { force: true }); } catch { } }
        if (created.dbPath) { try { rmSync(created.dbPath, { force: true }); } catch { } }
        if (created.configWritten) { try { rmSync(join(rootDir, ".amalia-root"), { force: true }); } catch { } }
      };

      try {
        const ver = await gitVersion();
        const m = ver.match(/(\d+)\.(\d+)/);
        if (!m || Number(m[1]) < 2 || (Number(m[1]) === 2 && Number(m[2]) < 5)) {
          console.error("Error: Git >= 2.5 is required"); process.exit(1);
        }
      } catch { console.error("Error: Git is not available"); process.exit(1); }

      if (!(await isInsideWorkTree(rootDir))) {
        console.error("Error: you are not inside a Git repository"); process.exit(1);
      }

      const nodeMajor = Number(process.version.slice(1).split(".")[0]);
      if (nodeMajor < 20) {
        console.error(`Error: Node >= 20 is required (current: ${process.version})`); process.exit(1);
      }

      try {
        const targetBranch = await currentBranch(rootDir);
        const cfg = { honeycomb_path: honeyPath, target_branch: targetBranch };

        for (const d of [honeycombDir(rootDir, cfg), orchestratorApiDir(rootDir, cfg), secretsDir(rootDir, cfg), join(honeycombDir(rootDir, cfg), "dashboard")]) {
          if (!existsSync(d)) {
            mkdirSync(d, { recursive: true });
            created.dirs.push(d);
          }
        }

        const db = openDb(dbPath(rootDir, cfg));
        created.dbPath = dbPath(rootDir, cfg);
        applySchema(db);

        const opToken = generateToken();
        const tokenPath = join(secretsDir(rootDir, cfg), "amalia.token");
        writeFileSync(tokenPath, opToken, "utf8");
        created.tokenPath = tokenPath;
        try { chmodSync(tokenPath, 0o600); } catch { }

        const aDir = amaliaWorktree(rootDir, cfg);
        if (!existsSync(aDir)) {
          mkdirSync(aDir, { recursive: true });
          created.dirs.push(aDir);
          await worktreeAdd(rootDir, aDir, targetBranch);
        }

        const tmpl = join(PACKAGE_ROOT, "templates");
        const vars: Record<string, string> = {
          name: "amalia",
          engine: "opencode",
          role: "Operator / orchestrator",
          connection_mode: "cli",
          model: "",
          start_command: "",
          endpoint: "",
          auth_env: "",
          api_base_url: defaultApiBaseUrl(),
          heartbeat_seconds: "60",
        };
        for (const name of ["AGENTS.md", "bee.md"]) {
          const src = join(tmpl, name);
          if (existsSync(src) && !existsSync(join(aDir, name))) {
            writeFileSync(join(aDir, name), renderTemplate(readFileSync(src, "utf8"), vars));
          }
        }
        const tasksDest = join(aDir, "tasks");
        if (!existsSync(tasksDest)) {
          mkdirSync(tasksDest, { recursive: true });
          created.dirs.push(tasksDest);
        }
        for (const f of ["tasks.md", "results.md"]) {
          const src = join(tmpl, "tasks", f);
          if (existsSync(src) && !existsSync(join(tasksDest, f))) {
            writeFileSync(join(tasksDest, f), readFileSync(src, "utf8"));
          }
        }

        db.prepare("INSERT INTO bees (id, name, worktree_path, engine, connection_mode, token_hash, status) VALUES (1, 'amalia', ?, 'opencode', 'cli', ?, 'idle')").run(aDir, hashToken(opToken));
        db.close();

        writeConfig(rootDir, cfg);
        created.configWritten = true;
        ensureGitignore(rootDir, honeyPath);
        created.gitignoreWritten = true;

        console.log(`✓ Hive initialized in ${honeyPath}/`);
        console.log(`  Target branch: ${targetBranch}`);
        console.log(`  Operator token: ${opToken.slice(0, 12)}...`);
      } catch (e: any) {
        cleanup();
        console.error("Error during init — changes were rolled back:");
        console.error(`  ${e.message ?? e}`);
        process.exit(1);
      }
    });
}
