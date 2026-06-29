export type BeeStatus = "offline" | "idle" | "busy";
export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "failed" | "cancelled";
export type TaskPriority = "high" | "medium" | "low";
export type BlockReason = "deps_unresolved" | "upstream_failed" | "retries_exhausted" | "timeout";
export type IntegrationStatus = "pending" | "success" | "conflict" | "aborted";
export type Outcome = "completed" | "failed";
export type Engine = "claude-code" | "opencode" | "copilot-cli" | "codex-cli" | "ollama" | "custom";
export type ConnectionMode = "cli" | "api";

export const SCHEMA_VERSION = 1;