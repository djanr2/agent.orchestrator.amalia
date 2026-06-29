import { test, expect } from "vitest";
import { openDb, applySchema } from "./index.js";
import { migrate, isSchemaCurrent } from "./migrate.js";

test("migrate no hace nada si ya está al día", () => {
  const db = openDb(":memory:");
  applySchema(db);
  expect(migrate(db)).toBe(1);
  expect(isSchemaCurrent(db)).toBe(true);
});
