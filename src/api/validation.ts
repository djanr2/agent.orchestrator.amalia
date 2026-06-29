import { z } from "zod";

export const BEE_NAME_RE = /^[a-z][a-z0-9-]*-bee$/;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
export const COMMIT_RE = /^[0-9a-f]{7,40}$/;

export const registerBeeSchema = z.object({
  worktree_path: z.string().min(1),
  engine: z.enum(["claude-code", "opencode", "copilot-cli", "codex-cli", "ollama", "custom"]),
  connection_mode: z.enum(["cli", "api"]),
  model: z.string().optional(),
  role_summary: z.string().optional(),
  heartbeat_seconds: z.number().int().positive().default(60),
});

export const createTaskSchema = z.object({
  assigned_to: z.string().min(1),
  description: z.string().min(1),
  acceptance_criteria: z.string().optional(),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  slug: z.string().regex(SLUG_RE),
  depends_on: z.array(z.string()).default([]),
  max_attempts: z.number().int().positive().default(3),
  max_run_seconds: z.number().int().positive().optional(),
});

export const claimSchema = z.object({
  instance_id: z.string().min(1),
});

export const resultSchema = z.object({
  outcome: z.enum(["completed", "failed"]),
  idempotency_key: z.string().min(1),
  files_changed: z.array(z.string()).optional(),
  decisions: z.string().optional(),
  blockers: z.string().optional(),
  notes: z.string().optional(),
});
