import { request } from "@/lib/http"

export type TraceFeedbackRequest = {
  trace_id: string
  score: number // -1.0 to 1.0
  comment?: string | null
  tags?: string[] | null
}

export type TraceFeedbackResponse = {
  id: string
  trace_id: string
  score: number
  comment?: string | null
  tags?: string[] | null
  created_at: string
}

const FEEDBACK_BASE = "/api/v1/feedback"
const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

/**
 * 创建追踪反馈
 * 
 * @param payload - 反馈数据
 * @returns 创建成功的反馈对象
 */
export async function createTraceFeedback(payload: TraceFeedbackRequest): Promise<TraceFeedbackResponse> {
  if (isTauriRuntime()) {
    return invokeTauri<TraceFeedbackResponse>("create_local_trace_feedback", {
      payload: {
        trace_id: payload.trace_id,
        score: payload.score,
        comment: payload.comment ?? null,
        tags: payload.tags ?? null,
      },
    })
  }

  return request<TraceFeedbackResponse>({
    url: FEEDBACK_BASE,
    method: "POST",
    data: payload,
  })
}
