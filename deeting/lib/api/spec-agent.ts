import { z } from "zod"

import { openApiSSE, request } from "@/lib/http"

// =====================
// Schema Definitions
// =====================

export const SpecNodeBaseSchema = z.object({
  id: z.string(),
  type: z.string(),
  desc: z.string().nullable().optional(),
  needs: z.array(z.string()).default([]),
})

export const SpecActionNodeSchema = SpecNodeBaseSchema.extend({
  type: z.literal("action"),
  instruction: z.string(),
  required_tools: z.array(z.string()).default([]),
  worker: z.string().optional().default("generic"),
  args: z.record(z.any()).optional().default({}),
  output_as: z.string().nullable().optional(),
  check_in: z.boolean().optional().default(false),
  model_override: z.string().nullable().optional(),
})

export const SpecLogicRuleSchema = z.object({
  condition: z.string(),
  next_node: z.string(),
  desc: z.string().nullable().optional(),
})

export const SpecLogicGateNodeSchema = SpecNodeBaseSchema.extend({
  type: z.literal("logic_gate"),
  input: z.string(),
  rules: z.array(SpecLogicRuleSchema),
  default: z.string(),
})

export const SpecReplanTriggerNodeSchema = SpecNodeBaseSchema.extend({
  type: z.literal("replan_trigger"),
  reason: z.string(),
  new_goal: z.string().nullable().optional(),
})

export const SpecNodeSchema = z.discriminatedUnion("type", [
  SpecActionNodeSchema,
  SpecLogicGateNodeSchema,
  SpecReplanTriggerNodeSchema,
])

export const SpecManifestSchema = z.object({
  spec_v: z.string(),
  project_name: z.string(),
  nodes: z.array(SpecNodeSchema),
  context: z.record(z.any()).optional().default({}),
})

export const SpecDraftRequestSchema = z.object({
  query: z.string().min(1),
  context: z.record(z.any()).optional().nullable(),
  model: z.string().nullable().optional(),
})

export const SpecDraftResponseSchema = z.object({
  plan_id: z.string(),
  manifest: SpecManifestSchema,
})

export const SpecExecutionStatusSchema = z.object({
  status: z.enum(["drafting", "running", "waiting", "completed", "error"]),
  progress: z.number().int().min(0).max(100),
})

export const SpecConnectionSchema = z.object({
  source: z.string(),
  target: z.string(),
})

export const SpecPlanDetailSchema = z.object({
  id: z.string(),
  project_name: z.string(),
  manifest: SpecManifestSchema,
  connections: z.array(SpecConnectionSchema).default([]),
  execution: SpecExecutionStatusSchema,
})

export const SpecNodeStatusSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "active", "completed", "error", "waiting"]),
  duration_ms: z.number().int().nullable().optional(),
  output_preview: z.string().nullable().optional(),
  pulse: z.string().nullable().optional(),
  skipped: z.boolean().optional().default(false),
})

export const SpecPlanStatusSchema = z.object({
  execution: SpecExecutionStatusSchema,
  nodes: z.array(SpecNodeStatusSchema),
  checkpoint: z.record(z.any()).nullable().optional(),
})

export const SpecPlanStartResponseSchema = z.object({
  status: z.string(),
  executed: z.number().int(),
})

export const SpecPlanInteractRequestSchema = z.object({
  node_id: z.string(),
  decision: z.string(),
  feedback: z.string().nullable().optional(),
})

export const SpecPlanInteractResponseSchema = z.object({
  plan_id: z.string(),
  node_id: z.string(),
  decision: z.string(),
})

export const SpecPlanNodeUpdateRequestSchema = z.object({
  model_override: z.string().nullable().optional(),
})

export const SpecPlanNodeUpdateResponseSchema = z.object({
  plan_id: z.string(),
  node_id: z.string(),
  model_override: z.string().nullable().optional(),
})

// Types
export type SpecNodeBase = z.infer<typeof SpecNodeBaseSchema>
export type SpecActionNode = z.infer<typeof SpecActionNodeSchema>
export type SpecLogicGateNode = z.infer<typeof SpecLogicGateNodeSchema>
export type SpecReplanTriggerNode = z.infer<typeof SpecReplanTriggerNodeSchema>
export type SpecNode = z.infer<typeof SpecNodeSchema>
export type SpecManifest = z.infer<typeof SpecManifestSchema>
export type SpecDraftRequest = z.infer<typeof SpecDraftRequestSchema>
export type SpecDraftResponse = z.infer<typeof SpecDraftResponseSchema>
export type SpecExecutionStatus = z.infer<typeof SpecExecutionStatusSchema>
export type SpecConnection = z.infer<typeof SpecConnectionSchema>
export type SpecPlanDetail = z.infer<typeof SpecPlanDetailSchema>
export type SpecNodeStatus = z.infer<typeof SpecNodeStatusSchema>
export type SpecPlanStatus = z.infer<typeof SpecPlanStatusSchema>
export type SpecPlanStartResponse = z.infer<typeof SpecPlanStartResponseSchema>
export type SpecPlanInteractRequest = z.infer<typeof SpecPlanInteractRequestSchema>
export type SpecPlanInteractResponse = z.infer<typeof SpecPlanInteractResponseSchema>
export type SpecPlanNodeUpdateRequest = z.infer<typeof SpecPlanNodeUpdateRequestSchema>
export type SpecPlanNodeUpdateResponse = z.infer<typeof SpecPlanNodeUpdateResponseSchema>

export type SpecDraftSseEvent =
  | { event: "drafting"; data: { status?: string } }
  | { event: "plan_init"; data: { plan_id: string; project_name?: string } }
  | { event: "node_added"; data: { node: SpecNode } }
  | { event: "link_added"; data: { source: string; target: string } }
  | { event: "plan_ready"; data: { plan_id: string } }
  | { event: "plan_error"; data: { message?: string } }

// =====================
// API Functions
// =====================

const SPEC_AGENT_BASE = "/api/v1/spec-agent"

export async function createSpecDraft(
  payload: SpecDraftRequest,
  options: { stream?: boolean } = {}
): Promise<SpecDraftResponse> {
  const data = await request<SpecDraftResponse>({
    url: `${SPEC_AGENT_BASE}/draft`,
    method: "POST",
    params: { stream: options.stream ?? false },
    data: payload,
  })
  return SpecDraftResponseSchema.parse(data)
}

export function streamSpecDraft(
  payload: SpecDraftRequest,
  handlers: {
    onEvent?: (event: SpecDraftSseEvent) => void
    onError?: (err: Error) => void
    onClose?: () => void
  } = {},
  control: {
    onCancel?: (cancel: () => void) => void
  } = {}
) {
  const body = JSON.stringify(payload)
  let settled = false

  const close = openApiSSE(`${SPEC_AGENT_BASE}/draft?stream=true`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
    },
    onMessage: (message) => {
      const event = message.event as SpecDraftSseEvent["event"] | undefined
      if (!event) return
      handlers.onEvent?.({ event, data: message.data as SpecDraftSseEvent["data"] })
      if (event === "plan_error") {
        settled = true
      }
    },
    onError: (err) => {
      if (settled) return
      settled = true
      handlers.onError?.(err)
    },
    onClose: () => {
      if (settled) return
      settled = true
      handlers.onClose?.()
    },
  })

  const cancel = () => {
    if (settled) return
    settled = true
    close()
  }
  control.onCancel?.(cancel)
  return cancel
}

export async function fetchSpecPlanDetail(planId: string): Promise<SpecPlanDetail> {
  const data = await request<SpecPlanDetail>({
    url: `${SPEC_AGENT_BASE}/plans/${planId}`,
    method: "GET",
  })
  return SpecPlanDetailSchema.parse(data)
}

export async function fetchSpecPlanStatus(planId: string): Promise<SpecPlanStatus> {
  const data = await request<SpecPlanStatus>({
    url: `${SPEC_AGENT_BASE}/plans/${planId}/status`,
    method: "GET",
  })
  return SpecPlanStatusSchema.parse(data)
}

export async function startSpecPlan(planId: string): Promise<SpecPlanStartResponse> {
  const data = await request<SpecPlanStartResponse>({
    url: `${SPEC_AGENT_BASE}/plans/${planId}/start`,
    method: "POST",
  })
  return SpecPlanStartResponseSchema.parse(data)
}

export async function interactSpecPlan(
  planId: string,
  payload: SpecPlanInteractRequest
): Promise<SpecPlanInteractResponse> {
  const data = await request<SpecPlanInteractResponse>({
    url: `${SPEC_AGENT_BASE}/plans/${planId}/interact`,
    method: "POST",
    data: payload,
  })
  return SpecPlanInteractResponseSchema.parse(data)
}

export async function updateSpecPlanNode(
  planId: string,
  nodeId: string,
  payload: SpecPlanNodeUpdateRequest
): Promise<SpecPlanNodeUpdateResponse> {
  const data = await request<SpecPlanNodeUpdateResponse>({
    url: `${SPEC_AGENT_BASE}/plans/${planId}/nodes/${nodeId}`,
    method: "PATCH",
    data: payload,
  })
  return SpecPlanNodeUpdateResponseSchema.parse(data)
}
