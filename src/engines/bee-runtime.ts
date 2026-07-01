import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { readBeeConfig, readBeeToken } from "./bee-config.js";
import { OrchestratorClient } from "./api-client.js";
import { readTaskFile, writeTaskFile, upsertTasksSummary, writeResultFile, upsertResultsSummary } from "../cli/replica.js";
import type { EngineAdapter, EngineContext, TaskSpec } from "./adapters/index.js";

export interface RuntimeOptions {
  beeDir: string;
  secretsDir: string;
  apiBaseUrl: string;
  engine: EngineAdapter;
  onLog?: (msg: string) => void;
  signal?: AbortSignal;
  /** Run a single claim→execute→report cycle then return, instead of looping
   *  forever as a persistent daemon. Useful for manual/one-off runs. */
  once?: boolean;
}

function log(opts: RuntimeOptions, msg: string): void {
  if (opts.onLog) opts.onLog(msg);
  else console.log(msg);
}

export async function runBee(opts: RuntimeOptions): Promise<void> {
  const config = readBeeConfig(opts.beeDir);
  const token = readBeeToken(opts.secretsDir, config.bee_name);
  const client = new OrchestratorClient(opts.apiBaseUrl, token, config.bee_name);
  const instanceId = randomUUID();

  log(opts, `${config.bee_name}: starting (engine=${config.engine}, instance=${instanceId})`);

  const reg = await client.register({
    worktree_path: opts.beeDir,
    engine: config.engine,
    connection_mode: config.connection_mode,
    model: config.model ?? undefined,
    heartbeat_seconds: config.heartbeat_seconds,
  });

  let beeId: number;
  let degraded = false;

  if (reg.ok) {
    beeId = reg.data.id;
    log(opts, `${config.bee_name}: registered as bee ${beeId}`);
  } else {
    log(opts, `Could not register (${reg.error}), degraded mode without API`);
    beeId = -1;
    degraded = true;
  }

  const hbTimer = setInterval(() => {
    if (beeId > 0) client.heartbeat(beeId).catch(() => {});
  }, config.heartbeat_seconds * 1000);
  hbTimer.unref();

  let running = true;
  const onSig = () => { running = false; };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => { running = false; }, { once: true });
  }

  const engineCtx: EngineContext = {
    beeDir: opts.beeDir,
    beeName: config.bee_name,
    beeId,
    config,
    instanceId,
    log: (m) => log(opts, m),
  };

  while (running) {
    try {
      degraded = await workOnce(client, opts, config.bee_name, beeId, instanceId, engineCtx, degraded);
    } catch (e: any) {
      log(opts, `Error in work cycle: ${e.message}`);
    }
    if (opts.once) break;
    await sleep(2000);
  }

  clearInterval(hbTimer);
  process.off("SIGINT", onSig);
  process.off("SIGTERM", onSig);
  log(opts, `${config.bee_name}: stopped`);
}

async function workOnce(
  client: OrchestratorClient,
  opts: RuntimeOptions,
  beeName: string,
  beeId: number,
  instanceId: string,
  ctx: EngineContext,
  degraded: boolean,
): Promise<boolean> {
  const tasksRes = await client.listMyTasks("pending");
  let tasks: PendingTask[];

  if (tasksRes.ok) {
    degraded = false;
    tasks = tasksRes.data;
  } else {
    if (!degraded) {
      log(opts, `API unavailable (${tasksRes.error}), degraded mode`);
      degraded = true;
    }
    tasks = readLocalPendingTasks(opts.beeDir);
  }

  if (tasks.length === 0) return degraded;

  const task = tasks[0];
  const label = task.code || task.slug;
  log(opts, `Claiming task ${label}`);

  // If offline and there's no real code, it can't be claimed via API
  const localOnly = degraded && !task.code;

  let claimed = false;
  if (localOnly) {
    log(opts, `'${task.slug}' run offline — pending reconciliation with the server`);
    claimed = true;
  } else if (degraded) {
    log(opts, `Degraded mode: marking ${label} as in_progress locally`);
    claimed = true;
  } else {
    const claimRes = await client.claim(task.code, instanceId);
    if (!claimRes.ok) {
      log(opts, `Could not claim ${task.code}: ${claimRes.error}, degraded mode`);
      degraded = true;
      claimed = true;
    } else if (!claimRes.data.claimed) {
      log(opts, `${task.code} not available to claim`);
      return degraded;
    } else {
      claimed = true;
    }
  }

  if (!claimed) return degraded;

  updateLocalTaskLock(opts.beeDir, task, beeId, instanceId, localOnly);

  log(opts, `Running ${label}...`);
  const taskSpec: TaskSpec = {
    code: task.code || task.slug,
    slug: task.slug,
    description: task.description,
    acceptance_criteria: task.acceptance_criteria,
    priority: task.priority,
    rev: task.rev,
  };
  const result = await opts.engine.run(taskSpec, ctx);
  log(opts, `Result for ${label}: ${result.outcome}`);

  let syncedRev = task.rev - 1;
  if (!degraded) {
    const reportRes = await client.reportResult(task.code, {
      outcome: result.outcome,
      idempotency_key: result.idempotency_key,
      files_changed: result.files_changed,
      decisions: result.decisions,
      blockers: result.blockers,
      notes: result.notes,
    });
    if (reportRes.ok) {
      syncedRev = task.rev;
      writeResultFile(opts.beeDir, {
        id: reportRes.data.result.id,
        slug: task.slug,
        task_code: task.code,
        outcome: result.outcome,
        attempt: reportRes.data.task.attempts,
        idempotency_key: result.idempotency_key,
        created_at: new Date().toISOString(),
        notes: result.notes,
        decisions: result.decisions,
        blockers: result.blockers,
        files_changed: result.files_changed,
      });
      upsertResultsSummary(opts.beeDir, [{
        id: reportRes.data.result.id,
        task_code: task.code,
        outcome: result.outcome,
        idempotency_key: result.idempotency_key,
        created_at: new Date().toISOString(),
      }]);
    } else {
      log(opts, `Could not report ${task.code}: ${reportRes.error}, saving locally`);
      degraded = true;
    }
  }

  // Always save a local result (even when reported successfully)
  if (degraded) {
    const localResultId = Date.now();
    writeResultFile(opts.beeDir, {
      id: localResultId,
      slug: task.slug,
      task_code: task.code || task.slug,
      outcome: result.outcome,
      attempt: task.rev,
      idempotency_key: result.idempotency_key,
      created_at: new Date().toISOString(),
      notes: result.notes,
      decisions: result.decisions,
      blockers: result.blockers,
      files_changed: result.files_changed,
    });
    upsertResultsSummary(opts.beeDir, [{
      id: localResultId,
      task_code: task.code || task.slug,
      outcome: result.outcome,
      idempotency_key: result.idempotency_key,
      created_at: new Date().toISOString(),
    }]);
  }

  // Update the local file with synced_rev and needs_reconciliation
  const existing = readTaskFile(opts.beeDir, task.slug);
  if (existing) {
    existing.frontmatter.synced_rev = syncedRev;
    existing.frontmatter.status = result.outcome === "completed" ? "completed" : "failed";
    existing.frontmatter.needs_reconciliation = localOnly || undefined;
    writeTaskFile(opts.beeDir, {
      id: existing.frontmatter.id,
      code: task.code || "",
      slug: task.slug,
      status: existing.frontmatter.status,
      assigned_to: beeId,
      priority: existing.frontmatter.priority,
      description: existing.body,
      acceptance_criteria: null,
      rev: existing.frontmatter.rev,
      locked_by: beeId,
      needs_reconciliation: localOnly,
    });
  }
  upsertTasksSummary(opts.beeDir, [{
    code: task.code || "",
    slug: task.slug,
    status: result.outcome === "completed" ? "completed" : "failed",
    assigned_to: beeId,
    priority: task.priority,
    rev: syncedRev,
    beeName: ctx.beeName,
  }]);

  return degraded;
}

interface PendingTask {
  code: string;
  slug: string;
  status: string;
  assigned_to: number;
  priority: string;
  rev: number;
  description: string;
  acceptance_criteria: string | null;
}

function readLocalPendingTasks(beeDir: string): PendingTask[] {
  const tasksDir = join(beeDir, "tasks");
  if (!existsSync(tasksDir)) return [];
  const files = readdirSync(tasksDir).filter((f) => f.endsWith(".task.md"));
  const result: PendingTask[] = [];
  for (const file of files) {
    const parsed = matter.read(join(tasksDir, file));
    const fm = parsed.data as any;
    if (fm.status === "pending") {
      result.push({
        code: fm.code || "",
        slug: file.replace(".task.md", ""),
        status: "pending",
        assigned_to: -1,
        priority: fm.priority || "medium",
        rev: fm.rev ?? 0,
        description: parsed.content,
        acceptance_criteria: null,
      });
    }
  }
  return result;
}

function updateLocalTaskLock(
  beeDir: string,
  task: { code: string; slug: string; rev: number; priority: string },
  beeId: number,
  instanceId: string,
  needsReconciliation?: boolean,
): void {
  const existing = readTaskFile(beeDir, task.slug);
  if (existing) {
    existing.frontmatter.rev += 1;
    existing.frontmatter.lock = `bee:${beeId}:${instanceId}`;
    existing.frontmatter.status = "in_progress";
    writeTaskFile(beeDir, {
      id: existing.frontmatter.id,
      code: task.code,
      slug: task.slug,
      status: "in_progress",
      assigned_to: beeId,
      priority: existing.frontmatter.priority,
      description: existing.body,
      acceptance_criteria: null,
      rev: existing.frontmatter.rev,
      locked_by: beeId,
      needs_reconciliation: needsReconciliation,
    });
  }
  upsertTasksSummary(beeDir, [{ ...task, assigned_to: beeId, status: "in_progress", beeName: "bee" }]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
