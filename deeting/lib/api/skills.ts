import { request } from "@/lib/http"

const BASE = "/api/v1/internal/skills"

export interface SkillExecutionRequest {
  inputs?: Record<string, any>
  session_id?: string
  stream?: boolean
  parent_trace_id?: string
}

export interface SkillExecutionResponse {
  status: "ok" | "error"
  result?: any
  error?: string
  trace_id?: string
  execution_id?: string
}

/**
 * Standardized Skill Orchestration Execution
 * Replaces manual prompt concatenation on the frontend.
 */
export async function executeSkill(
  skillId: string,
  payload: SkillExecutionRequest
): Promise<SkillExecutionResponse> {
  return request<SkillExecutionResponse>({
    url: `${BASE}/${skillId}/execute`,
    method: "POST",
    data: payload,
  })
}

/**
 * List registered skills available for orchestration
 */
export async function listInternalSkills() {
  return request<any[]>({
    url: BASE,
    method: "GET",
  })
}
