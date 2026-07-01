export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

export interface RegisterBeeInput {
  worktree_path: string;
  engine: string;
  connection_mode: string;
  model?: string;
  role_summary?: string;
  heartbeat_seconds?: number;
}

export interface BeeData {
  id: number;
  name: string;
  status: string;
  worktree_path: string;
  engine: string;
  connection_mode: string;
  model: string | null;
  role_summary: string | null;
  heartbeat_seconds: number;
  last_heartbeat_at: string | null;
}

export interface TaskData {
  id: number;
  code: string;
  slug: string;
  assigned_to: number;
  status: string;
  priority: string;
  description: string;
  acceptance_criteria: string | null;
  attempts: number;
  max_attempts: number;
  rev: number;
  locked_by: number | null;
  locked_by_instance: string | null;
  lease_expires_at: string | null;
}

export interface ClaimResult {
  claimed: boolean;
  task?: TaskData;
}

export interface ReportResultInput {
  outcome: "completed" | "failed";
  idempotency_key: string;
  files_changed?: string[];
  decisions?: string;
  blockers?: string;
  notes?: string;
}

export interface ReportResultData {
  result: any;
  task: TaskData;
}

/** Requests time out after this long: a stale keep-alive socket (e.g. after
 *  a multi-minute engine run leaves the connection idle) can otherwise hang
 *  fetch() forever instead of erroring, freezing the whole CLI process. */
const REQUEST_TIMEOUT_MS = 15_000;

export class OrchestratorClient {
  constructor(
    private baseUrl: string,
    private token: string,
    private beeName: string,
  ) {}

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }

  async register(input: RegisterBeeInput): Promise<ApiResult<BeeData>> {
    try {
      const res = await fetch(`${this.baseUrl}/bees/register`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await res.json();
      if (!res.ok) return { ok: false, status: res.status, error: body.error ?? "UNKNOWN" };
      return { ok: true, data: body as BeeData };
    } catch {
      return { ok: false, status: 0, error: "NETWORK_ERROR" };
    }
  }

  async heartbeat(beeId: number): Promise<ApiResult<{ ok: boolean }>> {
    try {
      const res = await fetch(`${this.baseUrl}/bees/${beeId}/heartbeat`, {
        method: "PATCH",
        headers: this.headers(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await res.json();
      if (!res.ok) return { ok: false, status: res.status, error: body.error ?? "UNKNOWN" };
      return { ok: true, data: body };
    } catch {
      return { ok: false, status: 0, error: "NETWORK_ERROR" };
    }
  }

  async listMyTasks(status?: string): Promise<ApiResult<TaskData[]>> {
    try {
      const params = new URLSearchParams({ assigned_to: this.beeName });
      if (status) params.set("status", status);
      const res = await fetch(`${this.baseUrl}/tasks?${params.toString()}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await res.json();
      if (!res.ok) return { ok: false, status: res.status, error: body.error ?? "UNKNOWN" };
      return { ok: true, data: body as TaskData[] };
    } catch {
      return { ok: false, status: 0, error: "NETWORK_ERROR" };
    }
  }

  async claim(code: string, instanceId: string): Promise<ApiResult<ClaimResult>> {
    try {
      const res = await fetch(`${this.baseUrl}/tasks/${code}/claim`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ instance_id: instanceId }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await res.json();
      if (res.status === 409) return { ok: true, data: body as ClaimResult };
      if (!res.ok) return { ok: false, status: res.status, error: body.error ?? "UNKNOWN" };
      return { ok: true, data: body as ClaimResult };
    } catch {
      return { ok: false, status: 0, error: "NETWORK_ERROR" };
    }
  }

  async reportResult(code: string, payload: ReportResultInput): Promise<ApiResult<ReportResultData>> {
    try {
      const res = await fetch(`${this.baseUrl}/tasks/${code}/results`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await res.json();
      if (!res.ok) return { ok: false, status: res.status, error: body.error ?? "UNKNOWN" };
      return { ok: true, data: body as ReportResultData };
    } catch {
      return { ok: false, status: 0, error: "NETWORK_ERROR" };
    }
  }
}
