import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gitVersion, isInsideWorkTree, currentBranch, statusPorcelain } from "./git.js";

function createTempRepo(): string {
  const dir = join(tmpdir(), `amalia-git-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# Test");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

test("gitVersion returns a version string", async () => {
  const ver = await gitVersion();
  expect(ver).toMatch(/\d+\.\d+/);
});

test("isInsideWorkTree is true inside a repo", async () => {
  const dir = createTempRepo();
  expect(await isInsideWorkTree(dir)).toBe(true);
  rmSync(dir, { recursive: true });
});

test("currentBranch returns main", async () => {
  const dir = createTempRepo();
  expect(await currentBranch(dir)).toBe("main");
  rmSync(dir, { recursive: true });
});

test("statusPorcelain is empty on a clean tree", async () => {
  const dir = createTempRepo();
  expect(await statusPorcelain(dir)).toBe("");
  rmSync(dir, { recursive: true });
});

test("statusPorcelain detects changes", async () => {
  const dir = createTempRepo();
  writeFileSync(join(dir, "new.txt"), "content");
  const status = await statusPorcelain(dir);
  expect(status).toContain("?? new.txt");
  rmSync(dir, { recursive: true });
});
