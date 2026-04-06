import { request } from "@/lib/http"

// =====================
// Types
// =====================

export type MonitorStatus = "active" | "paused" | "failed_suspended"
export type MonitorDisplayStatus =
  | MonitorStatus
  | "binding_required"
  | "binding_invalid"
export type MonitorExecutionTarget = "cloud" | "desktop"
export type MonitorDeliveryDetailLevel = "summary" | "stage" | "detailed"
export type MonitorRunEventKind =
  | "run_started"
  | "stage_changed"
  | "tool_called"
  | "tool_succeeded"
  | "tool_failed"
  | "run_completed"
  | "run_failed"
  | "delivery_failed"

export interface MonitorDeliveryPolicy {
  notify_on_change: boolean
  notify_on_failure: boolean
  heartbeat_enabled: boolean
  notify_on_start: boolean
  detail_level: MonitorDeliveryDetailLevel
}

export interface MonitorNotifyConfig {
  channel_ids?: string[]
  delivery_policy?: MonitorDeliveryPolicy
  force_notify?: boolean
}

export interface MonitorRunEvent {
  event_id: string
  execution_id: string
  task_id: string
  occurred_at: string
  seq: number
  kind: MonitorRunEventKind
  stage?: string | null
  step?: string | null
  state?: string | null
  summary?: string | null
  meta?: Record<string, unknown> | null
}

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
  display_status: MonitorDisplayStatus
  analysis_mode: "concise" | "deep" | "alert_first"
  policy_state: Record<string, unknown>
  binding_state: "ok" | "binding_required" | "binding_invalid"
  binding_error: string | null
  strategy_variants: {
    prompts?: Array<{ id: string; label: string; template: string }>
  } | null
  assistant_id: string | null
  assistant_name: string | null
  task_agent_id?: string | null
  task_agent_name?: string | null
  model_id: string | null
  error_count: number
  notify_config: MonitorNotifyConfig
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
    events?: MonitorRunEvent[]
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

export interface MonitorDeliveryStateRecord {
  task_id: string
  channel_id: string
  channel_kind: string
  channel_display_name: string | null
  status: string
  target_key: string
  anchor_message_id: string | null
  anchor_context: Record<string, unknown>
  updated_at: string
}

export interface MonitorDeliveryStateList {
  items: MonitorDeliveryStateRecord[]
  total: number
}

export interface MonitorTaskCreateInput {
  title: string
  objective: string
  assistant_id: string
  task_agent_id?: string
  cron_expr?: string
  analysis_mode?: "concise" | "deep" | "alert_first"
  notify_config?: MonitorNotifyConfig
  allowed_tools?: string[]
  execution_target?: MonitorExecutionTarget
}

export interface MonitorTaskUpdateInput {
  title?: string
  objective?: string
  assistant_id?: string
  task_agent_id?: string
  cron_expr?: string
  analysis_mode?: "concise" | "deep" | "alert_first"
  status?: MonitorStatus
  notify_config?: MonitorNotifyConfig
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
  notify_config: MonitorNotifyConfig
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

interface MonitorTaskActionResponse {
  id: string
  status?: MonitorStatus
  message: string
}

export interface MonitorTaskCreateResponse {
  id: string
  title: string
  status: string
  message: string
  analysis_mode?: "concise" | "deep" | "alert_first"
  assistant_id?: string | null
  task_agent_id?: string | null
  execution_target?: MonitorExecutionTarget
}

function withTaskAgentAliases<T extends { assistant_id?: string | null; assistant_name?: string | null }>(
  value: T,
): T & { task_agent_id: string | null; task_agent_name: string | null } {
  return {
    ...value,
    task_agent_id: value.assistant_id ?? null,
    task_agent_name: value.assistant_name ?? null,
  }
}

function normalizeMonitorTaskInput<T extends { assistant_id?: string; task_agent_id?: string }>(
  value: T,
): T {
  if (value.task_agent_id && !value.assistant_id) {
    return {
      ...value,
      assistant_id: value.task_agent_id,
    }
  }
  return value
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
  if (isTauriRuntime()) {
    const result = await invokeTauri<MonitorTaskList>("list_local_monitor_tasks", {
      query: {
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 100,
        status: params?.status ?? null,
      },
    })
    return {
      ...result,
      items: result.items.map((item) => withTaskAgentAliases(item)),
    }
  }
  const result = await request<MonitorTaskList>({
    url: MONITORS_BASE,
    method: "GET",
    params,
  })
  return {
    ...result,
    items: result.items.map((item) => withTaskAgentAliases(item)),
  }
}

export async function fetchMonitorStats(): Promise<MonitorStats> {
  if (isTauriRuntime()) {
    return invokeTauri<MonitorStats>("get_local_monitor_stats")
  }
  return request<MonitorStats>({
    url: `${MONITORS_BASE}/stats`,
    method: "GET",
  })
}

export async function fetchMonitorTask(taskId: string): Promise<MonitorTask> {
  if (isTauriRuntime()) {
    return withTaskAgentAliases(
      await invokeTauri<MonitorTask>("get_local_monitor_task", { taskId }),
    )
  }
  return withTaskAgentAliases(await request<MonitorTask>({
    url: `${MONITORS_BASE}/${taskId}`,
    method: "GET",
  }))
}

export async function createMonitorTask(
  data: MonitorTaskCreateInput
): Promise<MonitorTaskCreateResponse> {
  const normalized = normalizeMonitorTaskInput(data)
  if (isTauriRuntime()) {
    return withTaskAgentAliases(
      await invokeTauri<MonitorTaskCreateResponse>("create_local_monitor_task", {
        payload: normalized,
      }),
    )
  }
  return withTaskAgentAliases(await request<MonitorTaskCreateResponse>({
    url: MONITORS_BASE,
    method: "POST",
    data: normalized,
  }))
}

export async function updateMonitorTask(
  taskId: string,
  data: MonitorTaskUpdateInput
): Promise<MonitorTask> {
  const normalized = normalizeMonitorTaskInput(data)
  if (isTauriRuntime()) {
    return withTaskAgentAliases(await invokeTauri<MonitorTask>("update_local_monitor_task", {
      taskId,
      payload: normalized,
    }))
  }
  return withTaskAgentAliases(await request<MonitorTask>({
    url: `${MONITORS_BASE}/${taskId}`,
    method: "PATCH",
    data: normalized,
  }))
}

export async function pauseMonitorTask(taskId: string): Promise<MonitorTask> {
  if (isTauriRuntime()) {
    await invokeTauri<MonitorTaskActionResponse>("pause_local_monitor_task", {
      payload: { task_id: taskId },
    })
    return fetchMonitorTask(taskId)
  }
  return request<MonitorTask>({
    url: `${MONITORS_BASE}/${taskId}/pause`,
    method: "POST",
  })
}

export async function resumeMonitorTask(taskId: string): Promise<MonitorTask> {
  if (isTauriRuntime()) {
    await invokeTauri<MonitorTaskActionResponse>("resume_local_monitor_task", {
      payload: { task_id: taskId },
    })
    return fetchMonitorTask(taskId)
  }
  return request<MonitorTask>({
    url: `${MONITORS_BASE}/${taskId}/resume`,
    method: "POST",
  })
}

export async function triggerMonitorTask(taskId: string): Promise<{ message: string }> {
  if (isTauriRuntime()) {
    const response = await invokeTauri<{ task_id: string; message: string }>("trigger_local_monitor_task", {
      payload: { task_id: taskId },
    })
    return { message: response.message }
  }
  return request({
    url: `${MONITORS_BASE}/${taskId}/trigger`,
    method: "POST",
  })
}

export async function deleteMonitorTask(taskId: string): Promise<void> {
  if (isTauriRuntime()) {
    await invokeTauri("delete_local_monitor_task", { payload: { task_id: taskId } })
    return
  }
  return request({
    url: `${MONITORS_BASE}/${taskId}`,
    method: "DELETE",
  })
}

export async function fetchMonitorLogs(
  taskId: string,
  params?: { skip?: number; limit?: number }
): Promise<MonitorExecutionLogList> {
  if (isTauriRuntime()) {
    return invokeTauri<MonitorExecutionLogList>("list_local_monitor_logs", {
      query: {
        task_id: taskId,
        skip: params?.skip ?? 0,
        limit: params?.limit ?? 50,
      },
    })
  }
  return request<MonitorExecutionLogList>({
    url: `${MONITORS_BASE}/${taskId}/logs`,
    method: "GET",
    params,
  })
}

export async function fetchMonitorDeliveryStates(
  taskId: string
): Promise<MonitorDeliveryStateList> {
  if (isTauriRuntime()) {
    return invokeTauri<MonitorDeliveryStateList>("list_local_monitor_delivery_states", {
      taskId,
    })
  }
  throw new Error("delivery states are only supported in desktop local runtime")
}

export async function submitMonitorFeedback(
  taskId: string,
  logId: string,
  score: number
): Promise<void> {
  if (isTauriRuntime()) {
    await invokeTauri("submit_local_monitor_feedback", {
      payload: { task_id: taskId, log_id: logId, score },
    })
    return
  }
  return request({
    url: `${MONITORS_BASE}/feedback`,
    method: "POST",
    data: { task_id: taskId, log_id: logId, score },
  })
}

/** @deprecated 桌面端本地执行模式下无需调用此函数。 */
export async function monitorLocalHeartbeat(agentId: string): Promise<{
  status: string
  agent_id: string
  server_time: string
  expires_in_seconds: number
}> {
  if (isTauriRuntime()) {
    return {
      status: "ok",
      agent_id: agentId,
      server_time: new Date().toISOString(),
      expires_in_seconds: 0,
    }
  }
  return request({
    url: `${MONITORS_BASE}/local/heartbeat`,
    method: "POST",
    data: { agent_id: agentId },
  })
}

/** @deprecated 桌面端本地执行模式下无需调用此函数。 */
export async function monitorLocalPull(
  agentId: string,
  limit = 5
): Promise<MonitorLocalPullResponse> {
  if (isTauriRuntime()) {
    return {
      items: [],
      claimed: 0,
      server_time: new Date().toISOString(),
    }
  }
  return request<MonitorLocalPullResponse>({
    url: `${MONITORS_BASE}/local/pull`,
    method: "POST",
    data: { agent_id: agentId, limit },
  })
}

/** @deprecated 桌面端本地执行模式下无需调用此函数。 */
export async function monitorLocalReport(
  taskId: string,
  data: MonitorLocalReportInput
): Promise<{ task_id: string; status: string; message: string }> {
  if (isTauriRuntime()) {
    return {
      task_id: taskId,
      status: data.status,
      message: "本地模式无需云端回传",
    }
  }
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
  return invokeTauri<LocalMonitorWorkerStatus>("start_local_monitor_worker", {
    payload: {
      access_token: (options.accessToken ?? "").trim() || null,
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
