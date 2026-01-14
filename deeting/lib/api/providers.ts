import { z } from "zod"
import { ApiError, request } from "@/lib/http"

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

const safeNumber = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export const ProviderHubStatsSchema = z.object({
  total: z.preprocess(safeNumber, z.number()),
  connected: z.preprocess(safeNumber, z.number()),
  by_category: z.record(z.string(), z.preprocess(safeNumber, z.number())),
})

export const ProviderHubResponseSchema = z.object({
  providers: z.array(ProviderCardSchema),
  stats: ProviderHubStatsSchema,
})

export type ProviderHubStats = z.infer<typeof ProviderHubStatsSchema>
export type ProviderHubResponse = z.infer<typeof ProviderHubResponseSchema>
// Provider Verify Schemas
export const ProviderVerifyRequestSchema = z.object({
  preset_slug: z.string(),
  base_url: z.string(),
  api_key: z.string(),
  model: z.string().optional(),
  protocol: z.string().optional(),
  resource_name: z.string().optional(),
  deployment_name: z.string().optional(),
  project_id: z.string().optional(),
  region: z.string().optional(),
  api_version: z.string().optional(),
})

export const ProviderVerifyResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  latency_ms: z.number(),
  discovered_models: z.array(z.string()),
})

export type ProviderVerifyRequest = z.infer<typeof ProviderVerifyRequestSchema>
export type ProviderVerifyResponse = z.infer<typeof ProviderVerifyResponseSchema>

// Provider Instance Schemas
export const ProviderInstanceCreateSchema = z.object({
  preset_slug: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  base_url: z.string(),
  icon: z.string().nullable().optional(),
  theme_color: z.string().nullable().optional(),
  credentials_ref: z.string().nullable().optional(),
  api_key: z.string().nullable().optional(),
  protocol: z.string().nullable().optional(),
  model_prefix: z.string().nullable().optional(),
  resource_name: z.string().nullable().optional(),
  deployment_name: z.string().nullable().optional(),
  api_version: z.string().nullable().optional(),
  project_id: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  channel: z.string().default("external"),
  priority: z.number().default(0),
  is_enabled: z.boolean().default(true),
})

export const ProviderInstanceResponseSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid().optional().nullable(),
  preset_slug: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  base_url: z.string(),
  icon: z.string().nullable().optional(),
  theme_color: z.string().nullable().optional(),
  channel: z.string(),
  priority: z.number(),
  is_enabled: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  health_status: z.string().optional().nullable(),
  latency_ms: z.number().optional(),
  sparkline: z.array(z.number()).optional(),
})

export type ProviderInstanceCreate = z.infer<typeof ProviderInstanceCreateSchema>
export type ProviderInstanceResponse = z.infer<typeof ProviderInstanceResponseSchema>

// Provider Instance Update (partial)
export const ProviderInstanceUpdateSchema = ProviderInstanceCreateSchema.partial()
export type ProviderInstanceUpdate = z.infer<typeof ProviderInstanceUpdateSchema>

// Provider Model Schemas
export const ProviderModelResponseSchema = z.object({
  id: z.string().uuid(),
  instance_id: z.string().uuid(),
  capability: z.string(),
  model_id: z.string(),
  unified_model_id: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  upstream_path: z.string(),
  template_engine: z.string(),
  request_template: z.record(z.string(), z.any()),
  response_transform: z.record(z.string(), z.any()),
  pricing_config: z.record(z.string(), z.any()),
  limit_config: z.record(z.string(), z.any()),
  tokenizer_config: z.record(z.string(), z.any()),
  routing_config: z.record(z.string(), z.any()),
  source: z.string(),
  extra_meta: z.record(z.string(), z.any()),
  weight: z.number(),
  priority: z.number(),
  is_active: z.boolean(),
  synced_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export type ProviderModelResponse = z.infer<typeof ProviderModelResponseSchema>

// Provider Model Update
export const ProviderModelUpdateSchema = z.object({
  display_name: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  weight: z.number().optional(),
  priority: z.number().optional(),
  pricing_config: z.record(z.string(), z.any()).optional(),
  limit_config: z.record(z.string(), z.any()).optional(),
  tokenizer_config: z.record(z.string(), z.any()).optional(),
  routing_config: z.record(z.string(), z.any()).optional(),
})

export type ProviderModelUpdate = z.infer<typeof ProviderModelUpdateSchema>

// Provider Model Test
export const ProviderModelTestRequestSchema = z.object({
  prompt: z.string().optional(),
})

export type ProviderModelTestRequest = z.infer<typeof ProviderModelTestRequestSchema>

export const ProviderModelTestResponseSchema = z.object({
  success: z.boolean(),
  latency_ms: z.number(),
  status_code: z.number(),
  upstream_url: z.string(),
  response_body: z.record(z.string(), z.any()).nullable().optional(),
  error: z.string().nullable().optional(),
})

export type ProviderModelTestResponse = z.infer<typeof ProviderModelTestResponseSchema>

function parseModelsPayload(stage: string, data: unknown): ProviderModelResponse[] {
  // 为避免 zod 在未知情况下访问 _zod 抛错，直接对数组快速回退，保证 UI 不崩溃
  if (Array.isArray(data)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data as any as ProviderModelResponse[]
  }
  throw new ApiError("模型数据格式异常", { data })
}

// =====================
// API Functions
// =====================

function normalizeHubStats(raw: unknown): ProviderHubResponse["stats"] {
  const toNum = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }

  const by_category: Record<string, number> = {}
  const rawObj = raw as Record<string, unknown> | null
  const rawBy = rawObj?.by_category
  
  if (rawBy && typeof rawBy === "object") {
    for (const [k, v] of Object.entries(rawBy)) {
      by_category[k] = toNum(v)
    }
  }

  return {
    total: toNum(rawObj?.total),
    connected: toNum(rawObj?.connected),
    by_category,
  }
}

export async function fetchProviderHub(params?: {
  category?: string
  q?: string
  include_public?: boolean
}): Promise<ProviderHubResponse> {
  const data = await request<{ providers?: ProviderCard[]; stats?: unknown }>({
    url: `${PROVIDERS_BASE}/hub`,
    method: "GET",
    params,
  })

  return {
    providers: data?.providers ?? [],
    stats: normalizeHubStats(data?.stats),
  }
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

export async function updateProviderInstance(
  instanceId: string,
  payload: ProviderInstanceUpdate
): Promise<ProviderInstanceResponse> {
  const data = await request<ProviderInstanceResponse>({
    url: `${PROVIDERS_BASE}/instances/${instanceId}`,
    method: "PATCH",
    data: payload,
  })
  return ProviderInstanceResponseSchema.parse(data)
}

export async function deleteProviderInstance(instanceId: string): Promise<void> {
  await request<void>({
    url: `${PROVIDERS_BASE}/instances/${instanceId}`,
    method: "DELETE",
  })
}

export async function fetchProviderModels(
  instanceId: string
): Promise<ProviderModelResponse[]> {
  const data = await request<ProviderModelResponse[]>({
    url: `${PROVIDERS_BASE}/instances/${instanceId}/models`,
    method: "GET",
  })
  return parseModelsPayload("fetch", data)
}

export async function syncProviderModels(
  instanceId: string,
  options?: { preserve_user_overrides?: boolean }
): Promise<ProviderModelResponse[]> {
  const data = await request<ProviderModelResponse[]>({
    url: `${PROVIDERS_BASE}/instances/${instanceId}/models:sync`,
    method: "POST",
    params: {
      preserve_user_overrides: options?.preserve_user_overrides ?? true,
    },
  })
  return parseModelsPayload("sync", data)
}

export async function updateProviderModel(
  modelId: string,
  payload: ProviderModelUpdate
): Promise<ProviderModelResponse> {
  const data = await request<ProviderModelResponse>({
    url: `${PROVIDERS_BASE}/models/${modelId}`,
    method: "PATCH",
    data: payload,
  })
  return ProviderModelResponseSchema.parse(data)
}

export async function testProviderModel(
  modelId: string,
  payload?: ProviderModelTestRequest
): Promise<ProviderModelTestResponse> {
  const data = await request<ProviderModelTestResponse>({
    url: `${PROVIDERS_BASE}/models/${modelId}/test`,
    method: "POST",
    data: payload,
  })
  return ProviderModelTestResponseSchema.parse(data)
}
