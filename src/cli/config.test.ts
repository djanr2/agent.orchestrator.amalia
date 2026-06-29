import { test, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import { findRoot, readConfig, writeConfig, honeycombDir, amaliaWorktree, beeWorktree, dbPath, secretsDir, orchestratorApiDir } from "./config.js";

test("writeConfig y readConfig redondo", () => {
  const dir = join(tmpdir(), `amalia-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  writeConfig(dir, { honeycomb_path: "mi-panal", target_branch: "develop" });
  const config = readConfig(dir);

  expect(config.honeycomb_path).toBe("mi-panal");
  expect(config.target_branch).toBe("develop");
  rmSync(dir, { recursive: true });
});

test("findRoot encuentra .amalia-root desde subdirectorio", () => {
  const dir = join(tmpdir(), `amalia-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  writeConfig(dir, { honeycomb_path: "hc", target_branch: "main" });

  const sub = join(dir, "a", "b", "c");
  mkdirSync(sub, { recursive: true });

  const root = findRoot(sub);
  expect(root).toBe(dir);
  rmSync(dir, { recursive: true });
});

test("findRoot devuelve null si no hay .amalia-root", () => {
  const dir = join(tmpdir(), `amalia-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  expect(findRoot(dir)).toBeNull();
  rmSync(dir, { recursive: true });
});

test("path helpers devuelven rutas correctas", () => {
  const toNative = (p: string) => p.replace(/\//g, sep);
  const config = { honeycomb_path: "panal", target_branch: "main" };

  expect(honeycombDir("/repo", config)).toBe(toNative("/repo/panal"));
  expect(amaliaWorktree("/repo", config)).toBe(toNative("/repo/panal/amalia"));
  expect(beeWorktree("/repo", config, "db-bee")).toBe(toNative("/repo/panal/db-bee"));
  expect(orchestratorApiDir("/repo", config)).toBe(toNative("/repo/panal/orchestrator-api"));
  expect(secretsDir("/repo", config)).toBe(toNative("/repo/panal/orchestrator-api/.secrets"));
  expect(dbPath("/repo", config)).toBe(toNative("/repo/panal/orchestrator-api/amalia.db"));
});
