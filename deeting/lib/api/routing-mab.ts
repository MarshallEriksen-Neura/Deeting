import { z } from "zod"
import { request } from "@/lib/http"

// =====================
// Schema Definitions
// =====================

export const RoutingOverviewSchema = z.object({
  totalTrials: z.number(),
  overallSuccessRate: z.number(),
  activeArms: z.number(),
  cooldownArms: z.number(),
  totalArms: z.number(),
})

export const StrategyConfigSchema = z.object({
  strategy: z.string(),
  epsilon: z.number(),
  alpha: z.number(),
  beta: z.number(),
  vectorWeight: z.number(),
  banditWeight: z.number(),
  explorationBonus: z.number(),
})

export const ArmPerformanceItemSchema = z.object({
  provider: z.string(),
  model: z.string(),
  armId: z.string().nullable().optional(),
  status: z.string(),
  cooldownUntil: z.string().nullable().optional(),
  strategy: z.string(),
  epsilon: z.number(),
  alpha: z.number(),
  beta: z.number(),
  totalTrials: z.number(),
  successes: z.number(),
  failures: z.number(),
  successRate: z.number(),
  selectionRatio: z.number(),
  avgLatencyMs: z.number(),
  latencyP95Ms: z.number().nullable().optional(),
  totalCost: z.number(),
  lastReward: z.number(),
})

export const ArmPerformanceResponseSchema = z.object({
  arms: z.array(ArmPerformanceItemSchema),
})

export const SkillArmItemSchema = z.object({
  skillId: z.string().nullable().optional(),
  skillName: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  totalTrials: z.number(),
  successes: z.number(),
  failures: z.number(),
  successRate: z.number(),
  selectionRatio: z.number(),
  avgLatencyMs: z.number(),
  isExploring: z.boolean(),
})

export const SkillMabResponseSchema = z.object({
  skills: z.array(SkillArmItemSchema),
})

export const AssistantArmItemSchema = z.object({
  assistantId: z.string(),
  name: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  totalTrials: z.number(),
  positiveFeedback: z.number(),
  negativeFeedback: z.number(),
  ratingScore: z.number(),
  mabScore: z.number(),
  routingScore: z.number(),
  selectionRatio: z.number(),
  explorationBonus: z.number(),
  lastUsedAt: z.string().nullable().optional(),
  lastFeedbackAt: z.string().nullable().optional(),
  isExploring: z.boolean(),
})

export const AssistantMabResponseSchema = z.object({
  assistants: z.array(AssistantArmItemSchema),
})

// Types
export type RoutingOverview = z.infer<typeof RoutingOverviewSchema>
export type StrategyConfig = z.infer<typeof StrategyConfigSchema>
export type ArmPerformanceItem = z.infer<typeof ArmPerformanceItemSchema>
export type ArmPerformanceResponse = z.infer<typeof ArmPerformanceResponseSchema>
export type SkillArmItem = z.infer<typeof SkillArmItemSchema>
export type SkillMabResponse = z.infer<typeof SkillMabResponseSchema>
export type AssistantArmItem = z.infer<typeof AssistantArmItemSchema>
export type AssistantMabResponse = z.infer<typeof AssistantMabResponseSchema>

// =====================
// API Functions
// =====================

const BASE = "/api/v1/admin/routing-mab"
const INTERNAL_GATEWAY_BASE = "/api/v1/internal/gateway"

export async function reportBanditReward(payload: {
  trace_id: string
  reward: number // 1.0 for success/positive, 0.0 for failure/negative
  scene?: string
}): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>({
    url: `${INTERNAL_GATEWAY_BASE}/bandit/report`,
    method: "POST",
    data: payload,
  })
}

export async function fetchRoutingOverview(
  scene = "router:llm"
): Promise<RoutingOverview> {
  const data = await request<RoutingOverview>({
    url: `${BASE}/overview`,
    method: "GET",
    params: { scene },
  })
  return RoutingOverviewSchema.parse(data)
}

export async function fetchStrategyConfig(): Promise<StrategyConfig> {
  const data = await request<StrategyConfig>({
    url: `${BASE}/strategy`,
    method: "GET",
  })
  return StrategyConfigSchema.parse(data)
}

export async function fetchArmPerformance(
  scene = "router:llm"
): Promise<ArmPerformanceResponse> {
  const data = await request<ArmPerformanceResponse>({
    url: `${BASE}/arms`,
    method: "GET",
    params: { scene },
  })
  return ArmPerformanceResponseSchema.parse(data)
}

export async function fetchSkillMab(): Promise<SkillMabResponse> {
  const data = await request<SkillMabResponse>({
    url: `${BASE}/skills`,
    method: "GET",
  })
  return SkillMabResponseSchema.parse(data)
}

export async function fetchAssistantMab(): Promise<AssistantMabResponse> {
  const data = await request<AssistantMabResponse>({
    url: `${BASE}/assistants`,
    method: "GET",
  })
  return AssistantMabResponseSchema.parse(data)
}
