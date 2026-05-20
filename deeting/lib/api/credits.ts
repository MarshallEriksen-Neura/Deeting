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
  tokensByModel: z.record(z.string(), z.number()),
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

export const CreditsRechargePolicySchema = z.object({
  creditPerUnit: z.number().positive(),
  currency: z.string(),
})

export const CreditsRechargeResponseSchema = z.object({
  amount: z.number(),
  creditedAmount: z.number(),
  currency: z.string(),
  balance: z.number(),
  traceId: z.string(),
})

export const CreditsAlipayOrderResponseSchema = z.object({
  outTradeNo: z.string(),
  payUrl: z.string().url(),
  amount: z.number(),
  currency: z.string(),
  expectedCreditedAmount: z.number(),
})

export const CreditsAlipayOrderStatusSchema = z.object({
  outTradeNo: z.string(),
  status: z.enum(["pending", "success", "failed"]),
  tradeStatus: z.string().nullable().optional(),
  tradeNo: z.string().nullable().optional(),
  amount: z.number(),
  currency: z.string(),
  expectedCreditedAmount: z.number(),
  creditedAmount: z.number(),
  refreshed: z.boolean(),
})

export const CreditsRechargeOrderItemSchema = z.object({
  id: z.string(),
  outTradeNo: z.string(),
  tradeNo: z.string().nullable().optional(),
  status: z.enum(["pending", "success", "failed"]),
  tradeStatus: z.string().nullable().optional(),
  amount: z.number(),
  currency: z.string(),
  expectedCreditedAmount: z.number(),
  creditedAmount: z.number(),
  channel: z.string(),
  errorCode: z.string().nullable().optional(),
  errorDetail: z.string().nullable().optional(),
  failureReason: z.string().nullable().optional(),
  createdAt: z.string(),
  settledAt: z.string().nullable().optional(),
})

export const CreditsRechargeOrdersSchema = z.object({
  items: z.array(CreditsRechargeOrderItemSchema),
  nextOffset: z.number().nullable().optional(),
})

/** Platform model (credits-backed) for desktop sync and model picker */
export const CreditsPlatformModelSchema = z.object({
  id: z.string(),
  model_id: z.string(),
  display_name: z.string().optional(),
  capabilities: z.array(z.string()).optional().default([]),
  pricing: z.record(z.string(), z.unknown()).optional(),
  provider_name: z.string().optional().default(""),
  provider_slug: z.string().optional().default(""),
  provider_icon: z.string().nullable().optional(),
  provider_color: z.string().nullable().optional(),
})
export const CreditsPlatformModelsResponseSchema = z.object({
  models: z.array(CreditsPlatformModelSchema),
})

// Types
export type CreditsBalance = z.infer<typeof CreditsBalanceSchema>
export type CreditsConsumption = z.infer<typeof CreditsConsumptionSchema>
export type CreditsModelUsage = z.infer<typeof CreditsModelUsageSchema>
export type CreditsTransactionItem = z.infer<typeof CreditsTransactionItemSchema>
export type CreditsTransactions = z.infer<typeof CreditsTransactionsSchema>
export type CreditsRechargePolicy = z.infer<typeof CreditsRechargePolicySchema>
export type CreditsRechargeResponse = z.infer<typeof CreditsRechargeResponseSchema>
export type CreditsAlipayOrderResponse = z.infer<typeof CreditsAlipayOrderResponseSchema>
export type CreditsAlipayOrderStatus = z.infer<typeof CreditsAlipayOrderStatusSchema>
export type CreditsRechargeOrderItem = z.infer<typeof CreditsRechargeOrderItemSchema>
export type CreditsRechargeOrders = z.infer<typeof CreditsRechargeOrdersSchema>
export type CreditsPlatformModel = z.infer<typeof CreditsPlatformModelSchema>
export type CreditsPlatformModelsResponse = z.infer<typeof CreditsPlatformModelsResponseSchema>

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

export async function fetchCreditsRechargePolicy(): Promise<CreditsRechargePolicy> {
  const data = await request<CreditsRechargePolicy>({
    url: `${CREDITS_BASE}/recharge-policy`,
    method: "GET",
  })
  return CreditsRechargePolicySchema.parse(data)
}

export async function rechargeCredits(amount: number): Promise<CreditsRechargeResponse> {
  const data = await request<CreditsRechargeResponse>({
    url: `${CREDITS_BASE}/recharge`,
    method: "POST",
    data: { amount },
  })
  return CreditsRechargeResponseSchema.parse(data)
}

export async function createAlipayRechargeOrder(
  amount: number
): Promise<CreditsAlipayOrderResponse> {
  const data = await request<CreditsAlipayOrderResponse>({
    url: `${CREDITS_BASE}/recharge/alipay/order`,
    method: "POST",
    data: { amount },
  })
  return CreditsAlipayOrderResponseSchema.parse(data)
}

export async function fetchAlipayRechargeOrderStatus(
  outTradeNo: string,
  params?: { refresh?: boolean }
): Promise<CreditsAlipayOrderStatus> {
  const data = await request<CreditsAlipayOrderStatus>({
    url: `${CREDITS_BASE}/recharge/alipay/status`,
    method: "GET",
    params: {
      out_trade_no: outTradeNo,
      refresh: params?.refresh ?? false,
    },
  })
  return CreditsAlipayOrderStatusSchema.parse(data)
}

export async function fetchCreditsRechargeOrders(params?: {
  limit?: number
  offset?: number
  status?: "pending" | "success" | "failed" | null
  startDate?: string | null
  endDate?: string | null
  query?: string | null
  sortBy?: "time" | "amount"
  sortDirection?: "asc" | "desc"
}): Promise<CreditsRechargeOrders> {
  const data = await request<CreditsRechargeOrders>({
    url: `${CREDITS_BASE}/recharge/orders`,
    method: "GET",
    params: {
      limit: params?.limit ?? 20,
      offset: params?.offset ?? 0,
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.startDate ? { startDate: params.startDate } : {}),
      ...(params?.endDate ? { endDate: params.endDate } : {}),
      ...(params?.query ? { query: params.query } : {}),
      ...(params?.sortBy ? { sortBy: params.sortBy } : {}),
      ...(params?.sortDirection ? { sortDirection: params.sortDirection } : {}),
    },
  })
  return CreditsRechargeOrdersSchema.parse(data)
}

export async function exportCreditsRechargeOrdersCsv(params?: {
  status?: "pending" | "success" | "failed" | null
  startDate?: string | null
  endDate?: string | null
  query?: string | null
  sortBy?: "time" | "amount"
  sortDirection?: "asc" | "desc"
}): Promise<Blob> {
  return request<Blob>({
    url: `${CREDITS_BASE}/recharge/orders/export`,
    method: "GET",
    responseType: "blob",
    params: {
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.startDate ? { startDate: params.startDate } : {}),
      ...(params?.endDate ? { endDate: params.endDate } : {}),
      ...(params?.query ? { query: params.query } : {}),
      ...(params?.sortBy ? { sortBy: params.sortBy } : {}),
      ...(params?.sortDirection ? { sortDirection: params.sortDirection } : {}),
    },
  })
}

/** Platform models available for credits (desktop sync / model picker). */
export async function fetchCreditsModels(): Promise<CreditsPlatformModelsResponse> {
  if (
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
    ("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
  ) {
    return { models: [] }
  }

  const data = await request<CreditsPlatformModelsResponse>({
    url: `${CREDITS_BASE}/models`,
    method: "GET",
  })
  return CreditsPlatformModelsResponseSchema.parse(data)
}

/**
 * Credits billing proxy: POST chat completion via cloud (auth + balance + upstream).
 * Use when request_route is "platform". See docs/plans/cloud-billing-proxy-implementation.md.
 */
export async function createCreditsChatCompletion(payload: {
  model: string
  messages: Array<{ role: string; content: string }>
  stream?: boolean
  temperature?: number
  max_tokens?: number
  trace_id?: string
  session_id?: string
  tools?: unknown
}): Promise<Record<string, unknown>> {
  const data = await request<Record<string, unknown>>({
    url: `${CREDITS_BASE}/chat/completions`,
    method: "POST",
    data: payload,
  })
  return data
}
