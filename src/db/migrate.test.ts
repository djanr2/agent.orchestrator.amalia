import { test, expect } from "vitest";
import { openDb, applySchema } from "./index.js";
import { migrate, isSchemaCurrent } from "./migrate.js";

test("migrate does nothing if already up to date", () => {
  const db = openDb(":memory:");
  applySchema(db);
  expect(migrate(db)).toBe(1);
  expect(isSchemaCurrent(db)).toBe(true);
});
