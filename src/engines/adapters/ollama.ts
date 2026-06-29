import { randomUUID } from "node:crypto";
import type { EngineAdapter, EngineContext, TaskSpec } from "./index.js";

export const ollamaAdapter: EngineAdapter = {
  async run(task: TaskSpec, ctx: EngineContext): Promise<{ outcome: "completed" | "failed"; idempotency_key: string; files_changed?: string[]; decisions?: string; blockers?: string; notes?: string }> {
    const idempotencyKey = randomUUID();
    const endpoint = ctx.config.endpoint || "http://localhost:11434/api/generate";
    ctx.log(`Consultando Ollama en ${endpoint} para tarea ${task.code}`);

    try {
      const env: Record<string, string | undefined> = { AMALIA_TASK_CODE: task.code, AMALIA_BEE_NAME: ctx.beeName };
      if (ctx.config.auth_env) {
        env[ctx.config.auth_env] = process.env[ctx.config.auth_env];
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ctx.config.modelo ?? "llama3",
          prompt: `Resuelve la siguiente tarea:\n\n${task.description}\n\nCriterios de aceptación: ${task.acceptance_criteria ?? "ninguno"}`,
          stream: false,
        }),
      });
      if (!res.ok) {
        return {
          outcome: "failed",
          idempotency_key: idempotencyKey,
          blockers: `Ollama respondió con status ${res.status}`,
        };
      }
      const data = await res.json();
      return {
        outcome: "completed",
        idempotency_key: idempotencyKey,
        notes: data.response ?? JSON.stringify(data),
      };
    } catch (e: any) {
      return {
        outcome: "failed",
        idempotency_key: idempotencyKey,
        blockers: e.message,
      };
    }
  },
};
