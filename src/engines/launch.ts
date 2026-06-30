#!/usr/bin/env node
import { readBeeConfig } from "./bee-config.js";
import { runBee, type RuntimeOptions } from "./bee-runtime.js";
import { claudeCodeAdapter } from "./adapters/claude-code.js";
import { ollamaAdapter } from "./adapters/ollama.js";
import type { EngineAdapterMap } from "./adapters/index.js";

const ADAPTERS: EngineAdapterMap = {
  "claude-code": claudeCodeAdapter,
  opencode: claudeCodeAdapter,
  "copilot-cli": claudeCodeAdapter,
  "codex-cli": claudeCodeAdapter,
  ollama: ollamaAdapter,
  custom: claudeCodeAdapter,
};

export interface LaunchOptions {
  beeDir: string;
  secretsDir: string;
  apiBaseUrl: string;
}

export function getAdapter(beeDir: string): EngineAdapterMap[keyof EngineAdapterMap] {
  const config = readBeeConfig(beeDir);
  const adapter = ADAPTERS[config.engine];
  if (!adapter) {
    throw new Error(`Engine '${config.engine}' not supported. Supported: ${Object.keys(ADAPTERS).join(", ")}`);
  }
  return adapter;
}

export async function launchBee(opts: LaunchOptions): Promise<void> {
  const adapter = getAdapter(opts.beeDir);
  const runtimeOpts: RuntimeOptions = {
    ...opts,
    engine: adapter,
  };
  await runBee(runtimeOpts);
}

// Direct CLI: node launch.js --bee-dir=<path> --secrets-dir=<path> --api-base-url=<url>
if (process.argv[1] && (process.argv[1].endsWith("launch.js") || process.argv[1].endsWith("launch.ts"))) {
  const args = parseArgs(process.argv.slice(2));
  const beeDir = args["bee-dir"] ?? process.env.AMALIA_BEE_DIR;
  const secretsDir = args["secrets-dir"] ?? process.env.AMALIA_SECRETS_DIR;
  const apiBaseUrl = args["api-base-url"] ?? process.env.AMALIA_API_URL ?? "http://127.0.0.1:4000/api/orchestrator";

  if (!beeDir || !secretsDir) {
    console.error("Usage: launch.js --bee-dir=<path> --secrets-dir=<path> [--api-base-url=<url>]");
    console.error("  Or env vars: AMALIA_BEE_DIR, AMALIA_SECRETS_DIR, AMALIA_API_URL");
    process.exit(1);
  }

  launchBee({ beeDir, secretsDir, apiBaseUrl }).catch((e) => {
    console.error("Fatal error:", e.message);
    process.exit(1);
  });
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const arg of args) {
    const m = arg.match(/^--([^=]+)=(.+)/);
    if (m) result[m[1]] = m[2];
  }
  return result;
}
