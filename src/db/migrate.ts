import type { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION } from "../shared/types.js";
import { getSchemaVersion, transaction } from "./index.js";

type Migration = { to: number; up: (db: DatabaseSync) => void };

const MIGRATIONS: Migration[] = [];

export function migrate(db: DatabaseSync): number {
  let current = getSchemaVersion(db);
  for (const m of MIGRATIONS.filter((x) => x.to > current).sort((a, b) => a.to - b.to)) {
    transaction(db, () => {
      m.up(db);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(m.to);
    });
    current = m.to;
  }
  return current;
}

export function isSchemaCurrent(db: DatabaseSync): boolean {
  return getSchemaVersion(db) >= SCHEMA_VERSION;
}
