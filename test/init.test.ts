import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeConfig, honeycombDir, orchestratorApiDir, secretsDir, dbPath } from "../src/cli/config.js";
import { openDb, applySchema, getSchemaVersion } from "../src/db/index.js";
import { generateToken, hashToken } from "../src/api/auth.js";
import { ensureGitignore } from "../src/cli/gitignore.js";
import { SCHEMA_VERSION } from "../src/shared/types.js";

test("init crea estructura de panal correcta", () => {
  const root = join(tmpdir(), `amalia-init-test-${Date.now()}`);
  mkdirSync(root, { recursive: true });

  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  writeFileSync(join(root, "README.md"), "# Test");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root });

  const config = { honeycomb_path: "honeycomb", target_branch: "main" };

  for (const d of [honeycombDir(root, config), orchestratorApiDir(root, config), secretsDir(root, config)]) {
    mkdirSync(d, { recursive: true });
  }

  const db = openDb(dbPath(root, config));
  applySchema(db);
  expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
  db.close();

  const token = generateToken();
  writeFileSync(join(secretsDir(root, config), "amalia.token"), token, "utf8");

  writeConfig(root, config);
  ensureGitignore(root, "honeycomb");

  expect(existsSync(join(root, ".amalia-root"))).toBe(true);
  expect(existsSync(dbPath(root, config))).toBe(true);
  expect(existsSync(join(secretsDir(root, config), "amalia.token"))).toBe(true);

  const db2 = openDb(dbPath(root, config));
  expect(getSchemaVersion(db2)).toBe(1);
  db2.close();

  expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain(".amalia-root");

  rmSync(root, { recursive: true });
});
