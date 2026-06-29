import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SCHEMA_VERSION } from "../shared/types.js";

const here = dirname(fileURLToPath(import.meta.url));

export function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec("PRAGMA busy_timeout=5000;");
  return db;
}

export function applySchema(db: DatabaseSync): void {
  const ddl = readFileSync(join(here, "schema.sql"), "utf8");
  db.exec(ddl);
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
}

export function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'").get() as { name: string } | undefined;
  if (!row) return 0;
  const v = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null };
  return v.v ?? 0;
}
