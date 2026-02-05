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

/**
 * 创建追踪反馈
 * 
 * @param payload - 反馈数据
 * @returns 创建成功的反馈对象
 */
export async function createTraceFeedback(payload: TraceFeedbackRequest): Promise<TraceFeedbackResponse> {
  return request<TraceFeedbackResponse>({
    url: FEEDBACK_BASE,
    method: "POST",
    data: payload,
  })
}
