import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface BeeConfig {
  motor: string;
  modo_conexion: string;
  modelo: string | null;
  heartbeat_segundos: number;
  bee_name: string;
  api_base_url?: string;
  comando_arranque?: string;
  endpoint?: string;
  auth_env?: string;
}

/**
 * Lee la config de bee.md buscando secciones `## Motor` y `## Conexión al Orchestrator API`.
 * Cada sección lista `- **clave:** valor`.
 */
export function readBeeConfig(beeDir: string): BeeConfig {
  const beeMdPath = join(beeDir, "bee.md");
  if (!existsSync(beeMdPath)) {
    throw new Error(`No se encuentra bee.md en ${beeDir}`);
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
    motor: result["Motor"] ?? "",
    modo_conexion: result["Modo de conexión"] ?? "cli",
    modelo: result["Modelo"] ?? null,
    heartbeat_segundos: Number(result["Heartbeat (segundos)"]) || 60,
    bee_name: result["Nombre"] ?? "",
    api_base_url: result["URL de la API"] ?? undefined,
    comando_arranque: result["Comando de arranque"] ?? undefined,
    endpoint: result["Endpoint"] ?? undefined,
    auth_env: result["Variable de entorno (auth)"] ?? undefined,
  };

  if (!config.motor) throw new Error("bee.md: falta 'Motor' en sección ## Motor");
  return config;
}

export function readBeeToken(secretsDir: string, beeName: string): string {
  const tokenPath = join(secretsDir, `${beeName}.token`);
  if (!existsSync(tokenPath)) {
    throw new Error(`No se encuentra token para bee '${beeName}' en ${tokenPath}`);
  }
  return readFileSync(tokenPath, "utf8").trim();
}
