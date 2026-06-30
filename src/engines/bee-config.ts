import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface BeeConfig {
  engine: string;
  connection_mode: string;
  model: string | null;
  heartbeat_seconds: number;
  bee_name: string;
  api_base_url?: string;
  start_command?: string;
  endpoint?: string;
  auth_env?: string;
}

/**
 * Reads bee.md config by looking for the `## Engine` and `## Orchestrator API Connection`
 * sections. Each section lists `- **key:** value`.
 */
export function readBeeConfig(beeDir: string): BeeConfig {
  const beeMdPath = join(beeDir, "bee.md");
  if (!existsSync(beeMdPath)) {
    throw new Error(`bee.md not found in ${beeDir}`);
  }
  const raw = readFileSync(beeMdPath, "utf8");

  const lines = raw.split("\n");
  const result: Record<string, string> = {};

  let currentSection: string | null = null;
  for (const line of lines) {
    const sectionMatch = line.match(/^##\s+(.+)/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }
    const kvMatch = line.match(/^\s*-\s+\*\*(.+?):\*\*\s*(.*)/);
    if (kvMatch && currentSection) {
      result[kvMatch[1].trim()] = kvMatch[2].trim();
    }
  }

  const config: BeeConfig = {
    engine: result["Engine"] ?? "",
    connection_mode: result["Connection mode"] || "cli",
    model: result["Model"] ?? null,
    heartbeat_seconds: Number(result["Heartbeat (seconds)"]) || 60,
    bee_name: result["Name"] ?? "",
    api_base_url: result["API URL"] ?? undefined,
    start_command: result["Start command"] ?? undefined,
    endpoint: result["Endpoint"] ?? undefined,
    auth_env: result["Auth env var"] ?? undefined,
  };

  if (!config.engine) throw new Error("bee.md: missing 'Engine' in section ## Engine");
  return config;
}

export function readBeeToken(secretsDir: string, beeName: string): string {
  const tokenPath = join(secretsDir, `${beeName}.token`);
  if (!existsSync(tokenPath)) {
    throw new Error(`Token not found for bee '${beeName}' at ${tokenPath}`);
  }
  return readFileSync(tokenPath, "utf8").trim();
}
