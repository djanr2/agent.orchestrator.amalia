import { test, expect } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureGitignore, checkGitignore } from "./gitignore.js";

test("ensureGitignore crea archivo con bloque Amalia", () => {
  const dir = join(tmpdir(), `amalia-gitignore-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  ensureGitignore(dir, "honeycomb");
  const content = readFileSync(join(dir, ".gitignore"), "utf8");
  expect(content).toContain(".amalia-root");
  expect(content).toContain("honeycomb/");
  expect(checkGitignore(dir, "honeycomb")).toBe(true);

  rmSync(dir, { recursive: true });
});

test("ensureGitignore no duplica bloque si ya existe", () => {
  const dir = join(tmpdir(), `amalia-gitignore-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  ensureGitignore(dir, "panal");
  ensureGitignore(dir, "panal");

  const content = readFileSync(join(dir, ".gitignore"), "utf8");
  const matches = content.match(/\.amalia-root/g);
  expect(matches).toHaveLength(1);

  rmSync(dir, { recursive: true });
});

test("ensureGitignore respeta contenido previo", () => {
  const dir = join(tmpdir(), `amalia-gitignore-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, ".gitignore"), "node_modules/\n", "utf8");
  ensureGitignore(dir, "hc");

  const content = readFileSync(join(dir, ".gitignore"), "utf8");
  expect(content).toContain("node_modules/");
  expect(content).toContain(".amalia-root");

  rmSync(dir, { recursive: true });
});

test("checkGitignore devuelve false si no existe .gitignore", () => {
  expect(checkGitignore("/no-existe", "x")).toBe(false);
});
