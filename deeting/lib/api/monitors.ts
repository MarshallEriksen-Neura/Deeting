import { getAuthToken, request } from "@/lib/http"

// =====================
// Types
// =====================

export type MonitorStatus = "active" | "paused" | "failed_suspended"
export type MonitorExecutionTarget = "cloud" | "desktop" | "desktop_preferred"

export interface MonitorTask {
  id: string
  user_id: string
  title: string
  objective: string
  cron_expr: string
  status: MonitorStatus
  last_snapshot: Record<string, unknown> | null
  last_executed_at: string | null
  next_run_at: string | null
  current_interval_minutes: number | null
  strategy_variants: {
    prompts?: Array<{ id: string; label: string; template: string }>
  } | null
  assistant_id: string | null
  model_id: string | null
  error_count: number
  notify_config: Record<string, unknown>
  allowed_tools: string[]
  execution_target: MonitorExecutionTarget
  total_tokens: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface MonitorTaskList {
  items: MonitorTask[]
  total: number
  skip: number
  limit: number
}

export interface MonitorStats {
  total_tasks: number
  active_tasks: number
  paused_tasks: number
  failed_suspended_tasks: number
  total_tokens: number
  total_executions: number
}

export interface MonitorExecutionLog {
  id: string
  task_id: string
  triggered_at: string
  status: "success" | "failure" | "skipped"
  input_data: {
    strategy?: string
    model?: string
    snapshot?: Record<string, unknown>
  } | null
  output_data: {
    is_significant_change?: boolean
    change_summary?: string
    new_snapshot?: Record<string, unknown>
  } | null
  tokens_used: number
  error_message: string | null
  created_at: string
}

export interface MonitorExecutionLogList {
  items: MonitorExecutionLog[]
  total: number
  skip: number
  limit: number
}

export interface MonitorTaskCreateInput {
  title: string
  objective: string
  cron_expr?: string
  notify_config?: Record<string, unknown>
  allowed_tools?: string[]
  execution_target?: MonitorExecutionTarget
}

export interface MonitorTaskUpdateInput {
  title?: string
  objective?: string
  cron_expr?: string
  status?: MonitorStatus
  notify_config?: Record<string, unknown>
  allowed_tools?: string[]
  execution_target?: MonitorExecutionTarget
}

export interface MonitorLocalTaskPayload {
  task_id: string
  title: string
  objective: string
  cron_expr: string
  model_id: string | null
  allowed_tools: string[]
  last_snapshot: Record<string, unknown>
  notify_config: Record<string, unknown>
  execution_target: MonitorExecutionTarget
  claimed_until: string
}

export interface MonitorLocalPullResponse {
  items: MonitorLocalTaskPayload[]
  claimed: number
  server_time: string
}

export interface MonitorLocalReportInput {
  agent_id: string
  status: "success" | "failure" | "skipped"
  is_significant_change?: boolean
  change_summary?: string
  new_snapshot?: Record<string, unknown>
  tokens_used?: number
  error_message?: string
  force_notify?: boolean
  model_id?: string
  strategy?: string
}

export interface LocalMonitorWorkerStatus {
  running: boolean
  agent_id?: string | null
  poll_interval_seconds: number
  pull_limit: number
  last_tick_at?: string | null
  last_error?: string | null
  last_claimed: number
}

// =====================
// API Functions
// =====================

const MONITORS_BASE = "/api/v1/monitors"
const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export async function fetchMonitorTasks(params?: {
  skip?: number
  limit?: number
  status?: MonitorStatus
}): Promise<MonitorTaskList> {
  return request<MonitorTaskList>({
    url: MONITORS_BASE,
    method: "GET",
    params,
  })
}

export async function fetchMonitorStats(): Promise<MonitorStats> {
  return request<MonitorStats>({
    url: `${MONITORS_BASE}/stats`,
    method: "GET",
  })
}

export async function fetchMonitorTask(taskId: string): Promise<MonitorTask> {
  return request<MonitorTask>({
    url: `${MONITORS_BASE}/${taskId}`,
    method: "GET",
  })
}

export async function createMonitorTask(
  data: MonitorTaskCreateInput
): Promise<{ id: string; title: string; status: string; message: string; assistant_id: string }> {
  return request({
    url: MONITORS_BASE,
    method: "POST",
    data,
  })
}

export async function updateMonitorTask(
  taskId: string,
  data: MonitorTaskUpdateInput
): Promise<MonitorTask> {
  return request<MonitorTask>({
    url: `${MONITORS_BASE}/${taskId}`,
    method: "PATCH",
    data,
  })
}

export async function pauseMonitorTask(taskId: string): Promise<MonitorTask> {
  return request<MonitorTask>({
    url: `${MONITORS_BASE}/${taskId}/pause`,
    method: "POST",
  })
}

export async function resumeMonitorTask(taskId: string): Promise<MonitorTask> {
  return request<MonitorTask>({
    url: `${MONITORS_BASE}/${taskId}/resume`,
    method: "POST",
  })
}

export async function triggerMonitorTask(taskId: string): Promise<{ message: string }> {
  return request({
    url: `${MONITORS_BASE}/${taskId}/trigger`,
    method: "POST",
  })
}

export async function deleteMonitorTask(taskId: string): Promise<void> {
  return request({
    url: `${MONITORS_BASE}/${taskId}`,
    method: "DELETE",
  })
}

export async function fetchMonitorLogs(
  taskId: string,
  params?: { skip?: number; limit?: number }
): Promise<MonitorExecutionLogList> {
  return request<MonitorExecutionLogList>({
    url: `${MONITORS_BASE}/${taskId}/logs`,
    method: "GET",
    params,
  })
}

export async function submitMonitorFeedback(
  taskId: string,
  logId: string,
  score: number
): Promise<void> {
  return request({
    url: `${MONITORS_BASE}/feedback`,
    method: "POST",
    data: { task_id: taskId, log_id: logId, score },
  })
}

export async function monitorLocalHeartbeat(agentId: string): Promise<{
  status: string
  agent_id: string
  server_time: string
  expires_in_seconds: number
}> {
  return request({
    url: `${MONITORS_BASE}/local/heartbeat`,
    method: "POST",
    data: { agent_id: agentId },
  })
}

export async function monitorLocalPull(
  agentId: string,
  limit = 5
): Promise<MonitorLocalPullResponse> {
  return request<MonitorLocalPullResponse>({
    url: `${MONITORS_BASE}/local/pull`,
    method: "POST",
    data: { agent_id: agentId, limit },
  })
}

export async function monitorLocalReport(
  taskId: string,
  data: MonitorLocalReportInput
): Promise<{ task_id: string; status: string; message: string }> {
  return request({
    url: `${MONITORS_BASE}/local/${taskId}/report`,
    method: "POST",
    data,
  })
}

export async function getLocalMonitorWorkerStatus(): Promise<LocalMonitorWorkerStatus | null> {
  if (!isTauriRuntime()) {
    return null
  }
  return invokeTauri<LocalMonitorWorkerStatus>("get_local_monitor_worker_status")
}

export async function startLocalMonitorWorker(options: {
  accessToken?: string | null
  agentId?: string | null
  pollIntervalSeconds?: number
  pullLimit?: number
} = {}): Promise<LocalMonitorWorkerStatus | null> {
  if (!isTauriRuntime()) {
    return null
  }
  const token = (options.accessToken ?? getAuthToken() ?? "").trim()
  if (!token) {
    return null
  }
  return invokeTauri<LocalMonitorWorkerStatus>("start_local_monitor_worker", {
    payload: {
      access_token: token,
      agent_id: options.agentId ?? null,
      poll_interval_seconds: options.pollIntervalSeconds ?? null,
      pull_limit: options.pullLimit ?? null,
    },
  })
}

export async function stopLocalMonitorWorker(): Promise<LocalMonitorWorkerStatus | null> {
  if (!isTauriRuntime()) {
    return null
  }
  return invokeTauri<LocalMonitorWorkerStatus>("stop_local_monitor_worker")
}
