import { test, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beeWorktree, secretsDir, type AmaliaConfig } from "../config.js";
import { resolveRunTarget } from "./run.js";

let root: string;
const config: AmaliaConfig = { honeycomb_path: "honeycomb", target_branch: "main" };

beforeEach(() => {
  root = join(tmpdir(), `amalia-run-test-${Date.now()}`);
  mkdirSync(beeWorktree(root, config, "test-bee"), { recursive: true });
  mkdirSync(secretsDir(root, config), { recursive: true });
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows */ }
});

test("resolveRunTarget throws if the worktree doesn't exist", () => {
  expect(() => resolveRunTarget(root, config, "missing-bee")).toThrow("worktree not found");
});

test("resolveRunTarget throws if the token doesn't exist", () => {
  expect(() => resolveRunTarget(root, config, "test-bee")).toThrow("token not found");
});

test("resolveRunTarget returns the resolved paths when everything exists", () => {
  writeFileSync(join(secretsDir(root, config), "test-bee.token"), "dummy", "utf8");
  const target = resolveRunTarget(root, config, "test-bee");
  expect(target.beeDir).toBe(beeWorktree(root, config, "test-bee"));
  expect(target.secretsDir).toBe(secretsDir(root, config));
  expect(target.apiBaseUrl).toContain("/api/orchestrator");
});
