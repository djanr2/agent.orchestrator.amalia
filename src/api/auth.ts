import { randomBytes, createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface AuthIdentity {
  beeId: number;
  name: string;
  isOperator: boolean;
}

export function identifyByToken(db: DatabaseSync, token: string): AuthIdentity | null {
  if (!token) return null;
  const row = db.prepare("SELECT id, name FROM bees WHERE token_hash = ?").get(hashToken(token)) as
    | { id: number; name: string }
    | undefined;
  if (!row) return null;
  return { beeId: row.id, name: row.name, isOperator: row.name === "amalia" };
}
