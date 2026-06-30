import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { EngineAdapter, EngineContext, TaskSpec } from "./index.js";

/** Splits a configured start_command into a program and its base args, e.g.
 *  "claude -p" -> ["claude", "-p"]. Naive whitespace split — quoting is not
 *  supported; use a wrapper script in start_command if you need it. */
function splitCommand(command: string): [string, string[]] {
  const parts = command.trim().split(/\s+/);
  return [parts[0], parts.slice(1)];
}

export const claudeCodeAdapter: EngineAdapter = {
  async run(task: TaskSpec, ctx: EngineContext): Promise<{ outcome: "completed" | "failed"; idempotency_key: string; files_changed?: string[]; decisions?: string; blockers?: string; notes?: string }> {
    const idempotencyKey = randomUUID();
    const configured = ctx.config.start_command || "npx @anthropic-ai/claude-code -p";
    const [cmd, baseArgs] = splitCommand(configured);

    const prompt = `Solve the following task:\n\n${task.description}\n\nAcceptance criteria: ${task.acceptance_criteria ?? "none"}`;

    ctx.log(`Running ${ctx.config.engine} for task ${task.code}: ${configured}`);

    const env: Record<string, string> = {
      AMALIA_TASK_CODE: task.code,
      AMALIA_BEE_NAME: ctx.beeName,
    };
    if (ctx.config.auth_env && process.env[ctx.config.auth_env]) {
      env[ctx.config.auth_env] = process.env[ctx.config.auth_env]!;
    }

    try {
      // The task prompt is passed as the final positional argument, matching the
      // non-interactive / headless invocation pattern of most coding-agent CLIs
      // (e.g. `claude -p "<prompt>"`, `codex exec "<prompt>"`). Configure the
      // command + its flags via bee.md's "Start command" field per engine.
      const stdout = execFileSync(cmd, [...baseArgs, prompt], {
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
