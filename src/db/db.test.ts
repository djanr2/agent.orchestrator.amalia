import { test, expect } from "vitest";
import { openDb, applySchema, getSchemaVersion } from "./index.js";

test("creates the schema on a new in-memory DB and reports the version", () => {
  const db = openDb(":memory:");
  expect(getSchemaVersion(db)).toBe(0);
  applySchema(db);
  expect(getSchemaVersion(db)).toBe(1);
});

test("the expected tables exist", () => {
  const db = openDb(":memory:");
  applySchema(db);
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
  const tables = rows.map((r) => r.name);
  for (const t of ["bees", "tasks", "task_dependencies", "results", "integrations", "events", "schema_version"]) {
    expect(tables).toContain(t);
  }
});

test("foreign_keys is active", () => {
  const db = openDb(":memory:");
  const row = db.prepare("PRAGMA foreign_keys;").get() as { foreign_keys: number };
  expect(row.foreign_keys).toBe(1);
});
