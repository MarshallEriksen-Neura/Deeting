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
