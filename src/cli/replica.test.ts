import { test, expect } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeTaskFile, readTaskFile, taskFilePath } from "./replica.js";

test("writeTaskFile y readTaskFile redondo", () => {
  const beeDir = join(tmpdir(), `amalia-replica-${Date.now()}`);
  mkdirSync(beeDir, { recursive: true });

  writeTaskFile(beeDir, {
    id: 42,
    code: "TASK-42",
    slug: "mi-tarea",
    status: "pending",
    assigned_to: 2,
    priority: "high",
    description: "Descripción de prueba",
    acceptance_criteria: "Criterios",
    rev: 3,
    locked_by: null,
    beeName: "database-bee",
  });

  const filePath = taskFilePath(beeDir, "mi-tarea");
  expect(existsSync(filePath)).toBe(true);

  const content = readFileSync(filePath, "utf8");
  expect(content).toContain("slug: mi-tarea");
  expect(content).toContain("rev: 3");
  expect(content).toContain("synced_rev: 3");

  const loaded = readTaskFile(beeDir, "mi-tarea");
  expect(loaded).not.toBeNull();
  expect(loaded!.frontmatter.id).toBe(42);
  expect(loaded!.frontmatter.slug).toBe("mi-tarea");
  expect(loaded!.frontmatter.rev).toBe(3);
  expect(loaded!.frontmatter.synced_rev).toBe(3);
  expect(loaded!.frontmatter.estado).toBe("pending");
  expect(loaded!.body).toContain("Descripción de prueba");

  rmSync(beeDir, { recursive: true });
});

test("readTaskFile devuelve null si no existe", () => {
  const result = readTaskFile("/no-existe", "fake");
  expect(result).toBeNull();
});
