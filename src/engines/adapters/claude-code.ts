import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { EngineAdapter, EngineContext, TaskSpec } from "./index.js";

/** Splits a configured start_command into a program and its base args, e.g.
 *  "claude -p" -> ["claude", "-p"]. Naive whitespace split — quoting is not
 *  supported; use a wrapper script in start_command if you need it. */
function splitCommand(command: string): [string, string[]] {
  const parts = command.trim().split(/\s+/);
  return [parts[0], parts.slice(1)];
}

/** On Windows, npm-installed CLIs are `.cmd` batch shims. Those can only be
 *  run through cmd.exe (shell: true), which does not escape array args —
 *  letting task descriptions containing shell metacharacters inject
 *  arbitrary commands. Most shims just forward to a real .exe or a
 *  `node <script>` call one level down; resolve to that directly so we never
 *  need a shell at all. Falls back to the plain command if it can't resolve
 *  a shim (e.g. on POSIX, or a real binary already on PATH). */
function resolveWindowsCommand(cmd: string): [string, string[]] {
  if (process.platform !== "win32") return [cmd, []];
  if (/[\\/]/.test(cmd)) return [cmd, []]; // already a path, not a bare command name

  const dirs = (process.env.PATH ?? "").split(delimiter);
  for (const dir of dirs) {
    const cmdShim = join(dir, `${cmd}.cmd`);
    if (!existsSync(cmdShim)) continue;
    const content = readFileSync(cmdShim, "utf8");
    const dp0 = dir.endsWith("\\") ? dir : `${dir}\\`;

    const exeMatch = content.match(/"%dp0%\\([^"]+\.exe)"/i);
    if (exeMatch) return [join(dp0, exeMatch[1]), []];

    const nodeMatch = content.match(/node\s+"%dp0%\\([^"]+)"/i);
    if (nodeMatch) return [process.execPath, [join(dp0, nodeMatch[1])]];

    break; // shim found but pattern unrecognized: fall through to the shim itself
  }
  return [cmd, []];
}

export const claudeCodeAdapter: EngineAdapter = {
  async run(task: TaskSpec, ctx: EngineContext): Promise<{ outcome: "completed" | "failed"; idempotency_key: string; files_changed?: string[]; decisions?: string; blockers?: string; notes?: string }> {
    const idempotencyKey = randomUUID();
    const configured = ctx.config.start_command || "claude -p --allowedTools Read,Edit,Write,Bash --permission-mode acceptEdits";
    const [rawCmd, baseArgs] = splitCommand(configured);
    const [resolvedCmd, leadingArgs] = resolveWindowsCommand(rawCmd);

    const prompt = `Solve the following task:\n\n${task.description}\n\nAcceptance criteria: ${task.acceptance_criteria ?? "none"}`;

    ctx.log(`Running ${ctx.config.engine} for task ${task.code}: ${configured}`);

    const env: Record<string, string | undefined> = {
      ...process.env,
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
      // No shell is used: resolvedCmd/leadingArgs point straight at the real
      // executable, so args are passed as an argv array with no injection risk.
      // stdin is explicitly closed ("ignore") rather than left as an open
      // empty pipe: if the CLI ever tries to prompt for confirmation despite
      // the non-interactive flags, it hits EOF immediately and errors out
      // instead of hanging forever waiting for input that will never arrive.
      const stdout = execFileSync(resolvedCmd, [...leadingArgs, ...baseArgs, prompt], {
        cwd: ctx.beeDir,
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return {
        outcome: "completed",
        idempotency_key: idempotencyKey,
        notes: stdout.slice(0, 5000),
      };
    } catch (e: any) {
      // execFileSync's error carries stderr/stdout as strings (possibly empty,
      // never null/undefined) when encoding is set, so `??` never falls
      // through to e.message. Prefer the first non-empty source.
      const blockers = [e.stderr, e.stdout, e.message].find((s) => typeof s === "string" && s.trim().length > 0)
        ?? "Unknown error running the engine command";
      return {
        outcome: "failed",
        idempotency_key: idempotencyKey,
        blockers,
      };
    }
  },
};
