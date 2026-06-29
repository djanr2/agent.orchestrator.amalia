import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findRoot, readConfig, secretsDir } from "./config.js";

export function apiBaseUrl(): string {
  return process.env.AMALIA_PORT
    ? `http://127.0.0.1:${process.env.AMALIA_PORT}/api/orchestrator`
    : "http://127.0.0.1:4000/api/orchestrator";
}

export function operatorToken(): string {
  const root = findRoot(process.cwd());
  if (!root) throw new Error("No se encontró .amalia-root");
  const config = readConfig(root);
  return readFileSync(join(secretsDir(root, config), "amalia.token"), "utf8").trim();
}

export function apiHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${operatorToken()}` };
}
