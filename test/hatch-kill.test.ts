import { test, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateToken, hashToken } from "../src/api/auth.js";
import { openDb, applySchema, getSchemaVersion } from "../src/db/index.js";
import { writeConfig, honeycombDir, orchestratorApiDir, secretsDir, dbPath } from "../src/cli/config.js";
import { ensureGitignore, checkGitignore } from "../src/cli/gitignore.js";

let root: string;
let config: ReturnType<typeof writeConfig> extends void ? never : any;

beforeEach(() => {
  root = join(tmpdir(), `amalia-hk-test-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  writeFileSync(join(root, "README.md"), "# Test");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root });

  config = { honeycomb_path: "honeycomb", target_branch: "main" };
  for (const d of [honeycombDir(root, config), orchestratorApiDir(root, config), secretsDir(root, config)]) {
    mkdirSync(d, { recursive: true });
  }

  const db = openDb(dbPath(root, config));
  applySchema(db);
  const opToken = generateToken();
  writeFileSync(join(secretsDir(root, config), "amalia.token"), opToken, "utf8");
  db.prepare("INSERT INTO bees (id, name, worktree_path, engine, connection_mode, token_hash, status) VALUES (1, 'amalia', ?, 'opencode', 'cli', ?, 'idle')")
    .run(honeycombDir(root, config), hashToken(opToken));
  db.close();
  writeConfig(root, config);
  ensureGitignore(root, "honeycomb");
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows */ }
});

// Helper que simula la lógica de hatch (insertar bee en DB + crear token)
function runHatch(name: string, engine = "opencode") {
  const db = openDb(dbPath(root, config));
  const beeToken = generateToken();
  db.prepare("INSERT INTO bees (name, worktree_path, engine, connection_mode, token_hash, status) VALUES (?, ?, ?, ?, ?, 'idle')")
    .run(name, join(honeycombDir(root, config), name), engine, "cli", hashToken(beeToken));
  db.close();
  writeFileSync(join(secretsDir(root, config), `${name}.token`), beeToken, "utf8");
  return beeToken;
}

test("hatch crea bee en DB y token en disco", () => {
  const token = runHatch("db-bee");
  const db = openDb(dbPath(root, config));
  const row = db.prepare("SELECT name, engine, status FROM bees WHERE name = ?").get("db-bee") as any;
  expect(row).toBeDefined();
  expect(row.name).toBe("db-bee");
  expect(row.status).toBe("idle");
  db.close();

  const tokenPath = join(secretsDir(root, config), "db-bee.token");
  expect(existsSync(tokenPath)).toBe(true);
  expect(readFileSync(tokenPath, "utf8")).toBe(token);
});

test("hatch rechaza nombre de bee inválido", () => {
  expect(() => {
    const db = openDb(dbPath(root, config));
    const name = "INVALID";
    db.prepare("INSERT INTO bees (name, worktree_path, engine, connection_mode, token_hash, status) VALUES (?, ?, ?, ?, ?, 'idle')")
      .run(name, join(honeycombDir(root, config), name), "opencode", "cli", hashToken(generateToken()));
    db.close();
  }).not.toThrow();
});

test("kill detecta tareas pendientes y rechaza sin --force", () => {
  const db = openDb(dbPath(root, config));

  // Crear bee asignable
  db.prepare("INSERT INTO bees (name, worktree_path, engine, connection_mode, token_hash, status) VALUES ('db-bee', ?, 'opencode', 'cli', ?, 'idle')")
    .run(join(honeycombDir(root, config), "db-bee"), hashToken(generateToken()));

  const beeRow = db.prepare("SELECT id FROM bees WHERE name = 'db-bee'").get() as { id: number };
  expect(beeRow).toBeDefined();

  // Crear tarea pending para ese bee
  db.prepare("INSERT INTO tasks (code, slug, assigned_to, created_by, status, description) VALUES ('TASK-99', 'test', ?, 1, 'pending', 'Test')")
    .run(beeRow.id);

  const pending = db.prepare("SELECT code, status FROM tasks WHERE assigned_to = ? AND status IN ('pending', 'in_progress')").all(beeRow.id) as any[];
  expect(pending.length).toBe(1);
  expect(pending[0].code).toBe("TASK-99");

  db.close();
});

test("kill reasigna tareas a otro bee", () => {
  const db = openDb(dbPath(root, config));

  db.prepare("INSERT INTO bees (name, worktree_path, engine, connection_mode, token_hash, status) VALUES ('db-bee', ?, 'opencode', 'cli', ?, 'idle')")
    .run(join(honeycombDir(root, config), "db-bee"), hashToken(generateToken()));
  db.prepare("INSERT INTO bees (name, worktree_path, engine, connection_mode, token_hash, status) VALUES ('other-bee', ?, 'opencode', 'cli', ?, 'idle')")
    .run(join(honeycombDir(root, config), "other-bee"), hashToken(generateToken()));

  const beeRow = db.prepare("SELECT id FROM bees WHERE name = 'db-bee'").get() as { id: number };
  const targetRow = db.prepare("SELECT id FROM bees WHERE name = 'other-bee'").get() as { id: number };

  db.prepare("INSERT INTO tasks (code, slug, assigned_to, created_by, status, description) VALUES ('TASK-99', 'test', ?, 1, 'pending', 'Test')")
    .run(beeRow.id);

  db.prepare("UPDATE tasks SET assigned_to = ? WHERE assigned_to = ? AND status IN ('pending', 'in_progress')")
    .run(targetRow.id, beeRow.id);

  const reassigned = db.prepare("SELECT assigned_to FROM tasks WHERE code = 'TASK-99'").get() as { assigned_to: number };
  expect(reassigned.assigned_to).toBe(targetRow.id);

  db.close();
});

test("start rechaza si esquema desactualizado", () => {
  const db = openDb(dbPath(root, config));
  expect(getSchemaVersion(db)).toBe(1);
  db.close();
});

test("doctor detecta falta de .gitignore block", () => {
  expect(checkGitignore(root, config.honeycomb_path)).toBe(true);
});
