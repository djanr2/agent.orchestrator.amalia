import { test, expect } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeTaskFile, readTaskFile, taskFilePath } from "./replica.js";

test("writeTaskFile and readTaskFile round trip", () => {
  const beeDir = join(tmpdir(), `amalia-replica-${Date.now()}`);
  mkdirSync(beeDir, { recursive: true });

  writeTaskFile(beeDir, {
    id: 42,
    code: "TASK-42",
    slug: "my-task",
    status: "pending",
    assigned_to: 2,
    priority: "high",
    description: "Test description",
    acceptance_criteria: "Criteria",
    rev: 3,
    locked_by: null,
    beeName: "database-bee",
  });

  const filePath = taskFilePath(beeDir, "my-task");
  expect(existsSync(filePath)).toBe(true);

  const content = readFileSync(filePath, "utf8");
  expect(content).toContain("slug: my-task");
  expect(content).toContain("rev: 3");
  expect(content).toContain("synced_rev: 3");

  const loaded = readTaskFile(beeDir, "my-task");
  expect(loaded).not.toBeNull();
  expect(loaded!.frontmatter.id).toBe(42);
  expect(loaded!.frontmatter.slug).toBe("my-task");
  expect(loaded!.frontmatter.rev).toBe(3);
  expect(loaded!.frontmatter.synced_rev).toBe(3);
  expect(loaded!.frontmatter.status).toBe("pending");
  expect(loaded!.body).toContain("Test description");

  rmSync(beeDir, { recursive: true });
});

test("readTaskFile returns null if it doesn't exist", () => {
  const result = readTaskFile("/does-not-exist", "fake");
  expect(result).toBeNull();
});
