import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export interface AmaliaConfig {
  honeycomb_path: string;
  target_branch: string;
}

export function findRoot(startDir: string): string | null {
  let current = startDir;
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(current, ".amalia-root"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

export function readConfig(rootDir: string): AmaliaConfig {
  const raw = readFileSync(join(rootDir, ".amalia-root"), "utf8");
  const lines = raw.split("\n").filter((l) => l.includes(":"));
  const map: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    map[key] = val;
  }
  return {
    honeycomb_path: map.honeycomb_path || "honeycomb",
    target_branch: map.target_branch || "main",
  };
}

export function writeConfig(rootDir: string, config: AmaliaConfig): void {
  const content = `# Amalia root config — auto-generated
honeycomb_path: ${config.honeycomb_path}
target_branch: ${config.target_branch}
`;
  writeFileSync(join(rootDir, ".amalia-root"), content, "utf8");
}

export function honeycombDir(rootDir: string, config: AmaliaConfig): string {
  return join(rootDir, config.honeycomb_path);
}

export function amaliaWorktree(rootDir: string, config: AmaliaConfig): string {
  return join(honeycombDir(rootDir, config), "amalia");
}

export function beeWorktree(rootDir: string, config: AmaliaConfig, name: string): string {
  return join(honeycombDir(rootDir, config), name);
}

export function orchestratorApiDir(rootDir: string, config: AmaliaConfig): string {
  return join(honeycombDir(rootDir, config), "orchestrator-api");
}

export function secretsDir(rootDir: string, config: AmaliaConfig): string {
  return join(orchestratorApiDir(rootDir, config), ".secrets");
}

export function dbPath(rootDir: string, config: AmaliaConfig): string {
  return join(orchestratorApiDir(rootDir, config), "amalia.db");
}

export function pidPath(rootDir: string, config: AmaliaConfig): string {
  return join(orchestratorApiDir(rootDir, config), "api.pid");
}
