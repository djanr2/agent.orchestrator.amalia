export const BEE_NAME_RE = /^[a-z][a-z0-9-]*-bee$/;
export const TASK_CODE_RE = /^TASK-\d+$/;
export const BRANCH_NAME_RE = /^[a-zA-Z][a-zA-Z0-9._/-]*$/;
export const COMMIT_SHA_RE = /^[a-f0-9]{7,40}$/;

export function validateBeeName(name: string): boolean {
  return BEE_NAME_RE.test(name);
}

export function validateTaskCode(code: string): boolean {
  return TASK_CODE_RE.test(code);
}

export function validateBranchName(branch: string): boolean {
  return BRANCH_NAME_RE.test(branch) && branch.length <= 256;
}

export function validateCommitSha(sha: string): boolean {
  return COMMIT_SHA_RE.test(sha);
}
