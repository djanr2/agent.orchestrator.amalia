import { execFile } from "node:child_process";
import { validateBranchName, validateCommitSha } from "../shared/validation.js";

interface GitResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function runGit(args: string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
        code: err ? (err as any).code ?? 1 : 0,
      });
    });
  });
}

export async function gitVersion(): Promise<string> {
  const r = await runGit(["--version"], process.cwd());
  if (r.code !== 0) throw new Error("Git is not available");
  return r.stdout.trim();
}

export async function isInsideWorkTree(cwd: string): Promise<boolean> {
  const r = await runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  return r.stdout.trim() === "true";
}

export async function currentBranch(cwd: string): Promise<string> {
  const r = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return r.stdout.trim();
}

async function branchExists(repoDir: string, branch: string): Promise<boolean> {
  const r = await runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], repoDir);
  return r.code === 0;
}

export async function worktreeAdd(repoDir: string, path: string, branch: string): Promise<GitResult> {
  if (!validateBranchName(branch)) throw new Error(`Invalid branch name: ${branch}`);
  // `git worktree add <path> <branch>` requires the branch to already exist; if it
  // doesn't, it must be created with -b (typical case: new branch for a new bee).
  const exists = await branchExists(repoDir, branch);
  const args = exists
    ? ["worktree", "add", path, branch]
    : ["worktree", "add", "-b", branch, path];
  const r = await runGit(args, repoDir);
  if (r.code !== 0) {
    throw new Error(`git worktree add failed for '${branch}': ${r.stderr.trim() || r.stdout.trim()}`);
  }
  return r;
}

export async function worktreeRemove(repoDir: string, path: string, force = false): Promise<GitResult> {
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(path);
  return runGit(args, repoDir);
}

export async function statusPorcelain(cwd: string): Promise<string> {
  const r = await runGit(["status", "--porcelain"], cwd);
  return r.stdout.trim();
}

export async function fetch(cwd: string): Promise<GitResult> {
  return runGit(["fetch", "--all"], cwd);
}

export async function rebase(cwd: string, target: string): Promise<GitResult> {
  if (!validateBranchName(target)) throw new Error(`Invalid target branch: ${target}`);
  return runGit(["rebase", target], cwd);
}

export async function mergeNoFf(cwd: string, branch: string): Promise<GitResult> {
  if (!validateBranchName(branch)) throw new Error(`Invalid branch: ${branch}`);
  return runGit(["merge", "--no-ff", branch], cwd);
}

export async function cherryPick(cwd: string, sha: string): Promise<GitResult> {
  if (!validateCommitSha(sha)) throw new Error(`Invalid SHA: ${sha}`);
  return runGit(["cherry-pick", sha], cwd);
}

export async function cherry(cwd: string, target: string, branch: string): Promise<string> {
  if (!validateBranchName(target)) throw new Error(`Invalid target branch: ${target}`);
  if (!validateBranchName(branch)) throw new Error(`Invalid branch: ${branch}`);
  const r = await runGit(["cherry", target, branch], cwd);
  return r.stdout.trim();
}

export async function hasConflicts(cwd: string): Promise<boolean> {
  const r = await runGit(["status", "--porcelain"], cwd);
  return /^(UU|AA|DD)/m.test(r.stdout);
}

export async function rebaseAbort(cwd: string): Promise<GitResult> {
  return runGit(["rebase", "--abort"], cwd);
}

export async function mergeAbort(cwd: string): Promise<GitResult> {
  return runGit(["merge", "--abort"], cwd);
}
