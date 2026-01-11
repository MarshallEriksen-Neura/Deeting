import { z } from "zod"
import { request } from "@/lib/http"

const PROVIDERS_BASE = "/api/v1/providers"

// =====================
// Schema Definitions
// =====================

// Data Structures mapping to backend schemas
export const ProviderInstanceSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  is_enabled: z.boolean(),
  health_status: z.string(),
  latency_ms: z.number(),
})

export const ProviderCardSchema = z.object({
  slug: z.string(),
  name: z.string(),
  provider: z.string(),
  category: z.string(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  theme_color: z.string().nullable().optional(),
  base_url: z.string().nullable().optional(),
  url_template: z.string().nullable().optional(),
  tags: z.array(z.string()),
  capabilities: z.array(z.string()),
  is_popular: z.boolean(),
  sort_order: z.number(),
  connected: z.boolean(),
  instances: z.array(ProviderInstanceSummarySchema).optional(),
})

export type ProviderCard = z.infer<typeof ProviderCardSchema>

export const ProviderHubStatsSchema = z.object({
  total: z.number(),
  connected: z.number(),
  by_category: z.record(z.number()),
})

export const ProviderHubResponseSchema = z.object({
  providers: z.array(ProviderCardSchema),
  stats: ProviderHubStatsSchema,
})

export type ProviderHubResponse = z.infer<typeof ProviderHubResponseSchema>
// Provider Verify Schemas
export const ProviderVerifyRequestSchema = z.object({
  provider: z.string(),
  config: z.record(z.any()),
})

export const ProviderVerifyResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  details: z.record(z.any()).optional(),
})

export type ProviderVerifyRequest = z.infer<typeof ProviderVerifyRequestSchema>
export type ProviderVerifyResponse = z.infer<typeof ProviderVerifyResponseSchema>

// Provider Instance Schemas
export const ProviderInstanceCreateSchema = z.object({
  name: z.string(),
  provider_slug: z.string(),
  config: z.record(z.any()),
  is_enabled: z.boolean().default(true),
})

export const ProviderInstanceResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  provider_slug: z.string(),
  config: z.record(z.any()),
  is_enabled: z.boolean(),
  health_status: z.string(),
  latency_ms: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type ProviderInstanceCreate = z.infer<typeof ProviderInstanceCreateSchema>
export type ProviderInstanceResponse = z.infer<typeof ProviderInstanceResponseSchema>

// Provider Model Schemas
export const ProviderModelResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider_instance_id: z.string().uuid(),
  capabilities: z.array(z.string()),
  context_length: z.number().optional(),
  input_price_per_1k: z.number().optional(),
  output_price_per_1k: z.number().optional(),
  is_enabled: z.boolean(),
  metadata: z.record(z.any()).optional(),
})

export type ProviderModelResponse = z.infer<typeof ProviderModelResponseSchema>

// =====================
// API Functions
// =====================

export async function fetchProviderHub(params?: {
  category?: string
  q?: string
  include_public?: boolean
}): Promise<ProviderHubResponse> {
  const data = await request<ProviderHubResponse>({
    url: `${PROVIDERS_BASE}/hub`,
    method: "GET",
    params,
  })
  return ProviderHubResponseSchema.parse(data)
}

export async function fetchProviderDetail(slug: string): Promise<ProviderCard> {
  const data = await request<ProviderCard>({
    url: `${PROVIDERS_BASE}/presets/${slug}`,
    method: "GET",
  })
  return ProviderCardSchema.parse(data)
}

export async function verifyProvider(
  payload: ProviderVerifyRequest
): Promise<ProviderVerifyResponse> {
  const data = await request<ProviderVerifyResponse>({
    url: `${PROVIDERS_BASE}/verify`,
    method: "POST",
    data: payload,
  })
  return ProviderVerifyResponseSchema.parse(data)
}

export async function createProviderInstance(
  payload: ProviderInstanceCreate
): Promise<ProviderInstanceResponse> {
  const data = await request<ProviderInstanceResponse>({
    url: PROVIDERS_BASE,
    method: "POST",
    data: payload,
  })
  return ProviderInstanceResponseSchema.parse(data)
}

export async function fetchProviderInstances(params?: {
  include_public?: boolean
}): Promise<ProviderInstanceResponse[]> {
  const data = await request<ProviderInstanceResponse[]>({
    url: `${PROVIDERS_BASE}/instances`,
    method: "GET",
    params,
  })
  return z.array(ProviderInstanceResponseSchema).parse(data)
}

export async function fetchProviderModels(
  instanceId: string
): Promise<ProviderModelResponse[]> {
  const data = await request<ProviderModelResponse[]>({
    url: `${PROVIDERS_BASE}/instances/${instanceId}/models`,
    method: "GET",
  })
  return z.array(ProviderModelResponseSchema).parse(data)
}

export async function syncProviderModels(
  instanceId: string
): Promise<ProviderModelResponse[]> {
  const data = await request<ProviderModelResponse[]>({
    url: `${PROVIDERS_BASE}/instances/${instanceId}/models:sync`,
    method: "POST",
  })
  return z.array(ProviderModelResponseSchema).parse(data)
}
