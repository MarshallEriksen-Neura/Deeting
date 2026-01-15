import { z } from "zod"
import { request } from "@/lib/http"

// =====================
// Schema Definitions
// =====================

export const CreditsBalanceSchema = z.object({
  balance: z.number(),
  monthlySpent: z.number(),
  usedPercent: z.number(),
})

export const CreditsConsumptionPointSchema = z.object({
  date: z.string(),
  tokensByModel: z.record(z.number()),
})

export const CreditsConsumptionSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  days: z.number(),
  models: z.array(z.string()),
  timeline: z.array(CreditsConsumptionPointSchema),
})

export const CreditsModelUsageItemSchema = z.object({
  model: z.string(),
  tokens: z.number(),
  percentage: z.number(),
})

export const CreditsModelUsageSchema = z.object({
  totalTokens: z.number(),
  models: z.array(CreditsModelUsageItemSchema),
})

export const CreditsTransactionItemSchema = z.object({
  id: z.string(),
  traceId: z.string(),
  model: z.string().nullable().optional(),
  status: z.enum(["success", "pending", "failed"]),
  amount: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  createdAt: z.string(),
})

export const CreditsTransactionsSchema = z.object({
  items: z.array(CreditsTransactionItemSchema),
  nextOffset: z.number().nullable().optional(),
})

// Types
export type CreditsBalance = z.infer<typeof CreditsBalanceSchema>
export type CreditsConsumption = z.infer<typeof CreditsConsumptionSchema>
export type CreditsModelUsage = z.infer<typeof CreditsModelUsageSchema>
export type CreditsTransactionItem = z.infer<typeof CreditsTransactionItemSchema>
export type CreditsTransactions = z.infer<typeof CreditsTransactionsSchema>

// =====================
// API Functions
// =====================

const CREDITS_BASE = "/api/v1/credits"

export async function fetchCreditsBalance(): Promise<CreditsBalance> {
  const data = await request<CreditsBalance>({
    url: `${CREDITS_BASE}/balance`,
    method: "GET",
  })
  return CreditsBalanceSchema.parse(data)
}

export async function fetchCreditsConsumption(params?: { days?: number }): Promise<CreditsConsumption> {
  const data = await request<CreditsConsumption>({
    url: `${CREDITS_BASE}/consumption`,
    method: "GET",
    params: { days: params?.days ?? 30 },
  })
  return CreditsConsumptionSchema.parse(data)
}

export async function fetchCreditsModelUsage(params?: { days?: number }): Promise<CreditsModelUsage> {
  const data = await request<CreditsModelUsage>({
    url: `${CREDITS_BASE}/model-usage`,
    method: "GET",
    params: { days: params?.days ?? 30 },
  })
  return CreditsModelUsageSchema.parse(data)
}

export async function fetchCreditsTransactions(params?: {
  limit?: number
  offset?: number
}): Promise<CreditsTransactions> {
  const data = await request<CreditsTransactions>({
    url: `${CREDITS_BASE}/transactions`,
    method: "GET",
    params: {
      limit: params?.limit ?? 20,
      offset: params?.offset ?? 0,
    },
  })
  return CreditsTransactionsSchema.parse(data)
}
