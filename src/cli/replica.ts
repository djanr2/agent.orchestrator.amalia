import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import matter from "gray-matter";

export interface TaskFrontmatter {
  id: number;
  slug: string;
  status: string;
  assigned_to: string;
  priority: string;
  depends_on: string[];
  rev: number;
  synced_rev: number;
  lock: string | null;
  last_db_sync: string | null;
  needs_reconciliation?: boolean;
}

export interface ReplicaTask {
  frontmatter: TaskFrontmatter;
  body: string;
}

export interface ResultFrontmatter {
  id: number;
  task_code: string;
  outcome: string;
  attempt: number;
  idempotency_key: string;
  created_at: string;
  files_changed?: string[];
}

function tasksDir(beeDir: string): string {
  return join(beeDir, "tasks");
}

export function writeTaskFile(beeDir: string, task: { id: number; code: string; slug: string; status: string; assigned_to: number; priority: string; description: string; acceptance_criteria: string | null; rev: number; locked_by: number | null; beeName?: string; needs_reconciliation?: boolean }): void {
  const dir = tasksDir(beeDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const fm: TaskFrontmatter = {
    id: task.id,
    slug: task.slug,
    status: task.status,
    assigned_to: task.beeName ?? String(task.assigned_to),
    priority: task.priority,
    depends_on: [],
    rev: task.rev,
    synced_rev: task.rev,
    lock: task.locked_by ? String(task.locked_by) : null,
    last_db_sync: new Date().toISOString(),
  };
  if (task.needs_reconciliation) fm.needs_reconciliation = true;
  const body = [task.description, task.acceptance_criteria].filter(Boolean).join("\n\n");
  const file = matter.stringify(body, fm);
  writeFileSync(join(dir, `${task.slug}.task.md`), file, "utf8");
}

export function readTaskFile(beeDir: string, slug: string): ReplicaTask | null {
  const filePath = join(tasksDir(beeDir), `${slug}.task.md`);
  if (!existsSync(filePath)) return null;
  const parsed = matter.read(filePath);
  return { frontmatter: parsed.data as TaskFrontmatter, body: parsed.content };
}

export function upsertTasksSummary(beeDir: string, tasks: { code: string; slug: string; status: string; assigned_to: number; priority: string; rev: number; beeName?: string }[]): void {
  const dir = tasksDir(beeDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const header = `# Tasks — ${tasks.length > 0 ? `Bee ${tasks[0].beeName ?? tasks[0].assigned_to}` : "Unassigned"}

| Code | Slug | Status | Priority | Rev |
|------|------|--------|----------|-----|
`;
  const rows = tasks.map(
    (t) => `| ${t.code} | ${t.slug} | ${t.status} | ${t.priority} | ${t.rev} |`,
  ).join("\n");
  writeFileSync(join(dir, "tasks.md"), header + rows + "\n", "utf8");
}

export function writeResultFile(beeDir: string, result: { id: number; slug: string; task_code?: string; outcome: string; attempt: number; idempotency_key: string; created_at: string; notes?: string; decisions?: string; blockers?: string; files_changed?: string[] }): void {
  const dir = tasksDir(beeDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const fm: ResultFrontmatter = {
    id: result.id,
    task_code: result.task_code ?? "",
    outcome: result.outcome,
    attempt: result.attempt,
    idempotency_key: result.idempotency_key,
    created_at: result.created_at,
  };
  if (result.files_changed?.length) fm.files_changed = result.files_changed;

  const sections: string[] = [];
  if (result.notes) sections.push(`## Notes\n\n${result.notes}`);
  if (result.decisions) sections.push(`## Decisions\n\n${result.decisions}`);
  if (result.blockers) sections.push(`## Blockers\n\n${result.blockers}`);
  const body = sections.join("\n\n");

  const file = matter.stringify(body, fm);
  writeFileSync(join(dir, `${result.slug}.result.md`), file, "utf8");
}

export function upsertResultsSummary(beeDir: string, results: { id: number; task_code?: string; outcome: string; idempotency_key: string; created_at: string }[]): void {
  const dir = tasksDir(beeDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const header = `# Results

| ID | Task | Outcome | Idempotency | Created |
|----|------|---------|-------------|---------|
`;
  const rows = results.map(
    (r) => `| ${r.id} | ${r.task_code ?? ""} | ${r.outcome} | ${r.idempotency_key} | ${r.created_at} |`,
  ).join("\n");
  writeFileSync(join(dir, "results.md"), header + rows + "\n", "utf8");
}

export function taskFilePath(beeDir: string, slug: string): string {
  return join(tasksDir(beeDir), `${slug}.task.md`);
}
