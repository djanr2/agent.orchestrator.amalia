import type { BeeConfig } from "../bee-config.js";

export interface TaskSpec {
  code: string;
  slug: string;
  description: string;
  acceptance_criteria: string | null;
  priority: string;
  rev: number;
}

export interface EngineContext {
  beeDir: string;
  beeName: string;
  beeId: number;
  config: BeeConfig;
  instanceId: string;
  log: (msg: string) => void;
}

export interface EngineResult {
  outcome: "completed" | "failed";
  idempotency_key: string;
  files_changed?: string[];
  decisions?: string;
  blockers?: string;
  notes?: string;
}

export interface EngineAdapter {
  run(task: TaskSpec, ctx: EngineContext): Promise<EngineResult>;
}

export type EngineAdapterMap = Record<string, EngineAdapter>;
