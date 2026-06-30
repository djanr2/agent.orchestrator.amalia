import { test, expect } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureGitignore, checkGitignore } from "./gitignore.js";

test("ensureGitignore creates a file with the Amalia block", () => {
  const dir = join(tmpdir(), `amalia-gitignore-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  ensureGitignore(dir, "honeycomb");
  const content = readFileSync(join(dir, ".gitignore"), "utf8");
  expect(content).toContain(".amalia-root");
  expect(content).toContain("honeycomb/");
  expect(checkGitignore(dir, "honeycomb")).toBe(true);

  rmSync(dir, { recursive: true });
});

test("ensureGitignore doesn't duplicate the block if it already exists", () => {
  const dir = join(tmpdir(), `amalia-gitignore-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  ensureGitignore(dir, "hive");
  ensureGitignore(dir, "hive");

  const content = readFileSync(join(dir, ".gitignore"), "utf8");
  const matches = content.match(/\.amalia-root/g);
  expect(matches).toHaveLength(1);

  rmSync(dir, { recursive: true });
});

test("ensureGitignore preserves previous content", () => {
  const dir = join(tmpdir(), `amalia-gitignore-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, ".gitignore"), "node_modules/\n", "utf8");
  ensureGitignore(dir, "hc");

  const content = readFileSync(join(dir, ".gitignore"), "utf8");
  expect(content).toContain("node_modules/");
  expect(content).toContain(".amalia-root");

  rmSync(dir, { recursive: true });
});

test("checkGitignore returns false if .gitignore doesn't exist", () => {
  expect(checkGitignore("/does-not-exist", "x")).toBe(false);
});
