import { test, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import { findRoot, readConfig, writeConfig, honeycombDir, amaliaWorktree, beeWorktree, dbPath, secretsDir, orchestratorApiDir } from "./config.js";

test("writeConfig and readConfig round trip", () => {
  const dir = join(tmpdir(), `amalia-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  writeConfig(dir, { honeycomb_path: "my-hive", target_branch: "develop" });
  const config = readConfig(dir);

  expect(config.honeycomb_path).toBe("my-hive");
  expect(config.target_branch).toBe("develop");
  rmSync(dir, { recursive: true });
});

test("findRoot finds .amalia-root from a subdirectory", () => {
  const dir = join(tmpdir(), `amalia-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  writeConfig(dir, { honeycomb_path: "hc", target_branch: "main" });

  const sub = join(dir, "a", "b", "c");
  mkdirSync(sub, { recursive: true });

  const root = findRoot(sub);
  expect(root).toBe(dir);
  rmSync(dir, { recursive: true });
});

test("findRoot returns null if there's no .amalia-root", () => {
  const dir = join(tmpdir(), `amalia-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  expect(findRoot(dir)).toBeNull();
  rmSync(dir, { recursive: true });
});

test("path helpers return correct paths", () => {
  const toNative = (p: string) => p.replace(/\//g, sep);
  const config = { honeycomb_path: "hive", target_branch: "main" };

  expect(honeycombDir("/repo", config)).toBe(toNative("/repo/hive"));
  expect(amaliaWorktree("/repo", config)).toBe(toNative("/repo/hive/amalia"));
  expect(beeWorktree("/repo", config, "db-bee")).toBe(toNative("/repo/hive/db-bee"));
  expect(orchestratorApiDir("/repo", config)).toBe(toNative("/repo/hive/orchestrator-api"));
  expect(secretsDir("/repo", config)).toBe(toNative("/repo/hive/orchestrator-api/.secrets"));
  expect(dbPath("/repo", config)).toBe(toNative("/repo/hive/orchestrator-api/amalia.db"));
});
