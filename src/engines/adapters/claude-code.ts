import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { EngineAdapter, EngineContext, TaskSpec } from "./index.js";

export const claudeCodeAdapter: EngineAdapter = {
  async run(task: TaskSpec, ctx: EngineContext): Promise<{ outcome: "completed" | "failed"; idempotency_key: string; files_changed?: string[]; decisions?: string; blockers?: string; notes?: string }> {
    const idempotencyKey = randomUUID();
    const cmd = ctx.config.comando_arranque || "npx @anthropic-ai/claude-code";
    ctx.log(`Ejecutando claude-code para tarea ${task.code}: ${cmd}`);

    const env: Record<string, string> = {
      AMALIA_TASK_CODE: task.code,
      AMALIA_BEE_NAME: ctx.beeName,
    };
    if (ctx.config.auth_env && process.env[ctx.config.auth_env]) {
      env[ctx.config.auth_env] = process.env[ctx.config.auth_env]!;
    }

    try {
      const stdout = execFileSync(cmd, ["--task", task.description], {
        cwd: ctx.beeDir,
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
        env,
        encoding: "utf8",
      });
      return {
        outcome: "completed",
        idempotency_key: idempotencyKey,
        notes: stdout.slice(0, 5000),
      };
    } catch (e: any) {
      return {
        outcome: "failed",
        idempotency_key: idempotencyKey,
        blockers: e.stderr ?? e.message,
      };
    }
  },
};
