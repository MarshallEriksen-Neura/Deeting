import { request } from "@/lib/http"

// =====================
// Types
// =====================

export type MonitorStatus = "active" | "paused" | "failed_suspended"

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
}

export interface MonitorTaskUpdateInput {
  title?: string
  objective?: string
  cron_expr?: string
  status?: MonitorStatus
  notify_config?: Record<string, unknown>
  allowed_tools?: string[]
}

// =====================
// API Functions
// =====================

const MONITORS_BASE = "/api/v1/monitors"

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
