import { z } from "zod"

import { request } from "@/lib/http"

const API_KEYS_BASE = "/api/v1/api-keys"

// =====================
// Schema Definitions
// =====================

export const ApiKeyStatusSchema = z.enum(["active", "limited", "revoked", "expired"])
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>

export const ApiKeySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(), // e.g., "sk-deet-a1b2"
  // Core permissions
  budget_limit: z.number().nullable(),
  budget_used: z.number(),
  allowed_models: z.array(z.string()),
  rate_limit: z.number().nullable(), // requests per minute
  allowed_ips: z.array(z.string()),
  enable_logging: z.boolean(),
  // Lifecycle
  status: ApiKeyStatusSchema,
  last_used_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type ApiKey = z.infer<typeof ApiKeySchema>

export const ApiKeyListResponseSchema = z.object({
  items: z.array(ApiKeySchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
})

export type ApiKeyListResponse = z.infer<typeof ApiKeyListResponseSchema>

// Create API Key
export const CreateApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(100),
  expiration: z.enum(["never", "7d", "30d", "90d", "custom"]),
  expires_at: z.string().optional(), // ISO date string for custom expiration
  budget_limit: z.number().min(0).nullable().optional(),
  allowed_models: z.array(z.string()).optional(),
  rate_limit: z.number().int().min(1).nullable().optional(),
  allowed_ips: z.array(z.string()).optional(),
  enable_logging: z.boolean().optional(),
})

export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>

export const CreateApiKeyResponseSchema = z.object({
  api_key: ApiKeySchema,
  secret: z.string(), // Full secret, only shown once
})

export type CreateApiKeyResponse = z.infer<typeof CreateApiKeyResponseSchema>

// Update API Key
export const UpdateApiKeyRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  budget_limit: z.number().min(0).nullable().optional(),
  allowed_models: z.array(z.string()).optional(),
  rate_limit: z.number().int().min(1).nullable().optional(),
  allowed_ips: z.array(z.string()).optional(),
  enable_logging: z.boolean().optional(),
})

export type UpdateApiKeyRequest = z.infer<typeof UpdateApiKeyRequestSchema>

// Roll API Key (regenerate secret)
export const RollApiKeyResponseSchema = z.object({
  api_key: ApiKeySchema,
  secret: z.string(), // New secret
})

export type RollApiKeyResponse = z.infer<typeof RollApiKeyResponseSchema>

// =====================
// API Functions
// =====================

export async function fetchApiKeys(params?: {
  page?: number
  page_size?: number
}): Promise<ApiKeyListResponse> {
  const data = await request<ApiKeyListResponse>({
    url: API_KEYS_BASE,
    method: "GET",
    params,
  })
  return ApiKeyListResponseSchema.parse(data)
}

export async function fetchApiKeyById(id: string): Promise<ApiKey> {
  const data = await request<ApiKey>({
    url: `${API_KEYS_BASE}/${id}`,
    method: "GET",
  })
  return ApiKeySchema.parse(data)
}

export async function createApiKey(
  payload: CreateApiKeyRequest
): Promise<CreateApiKeyResponse> {
  const data = await request<CreateApiKeyResponse>({
    url: API_KEYS_BASE,
    method: "POST",
    data: payload,
  })
  return CreateApiKeyResponseSchema.parse(data)
}

export async function updateApiKey(
  id: string,
  payload: UpdateApiKeyRequest
): Promise<ApiKey> {
  const data = await request<ApiKey>({
    url: `${API_KEYS_BASE}/${id}`,
    method: "PATCH",
    data: payload,
  })
  return ApiKeySchema.parse(data)
}

export async function revokeApiKey(id: string): Promise<ApiKey> {
  const data = await request<ApiKey>({
    url: `${API_KEYS_BASE}/${id}/revoke`,
    method: "POST",
  })
  return ApiKeySchema.parse(data)
}

export async function rollApiKey(id: string): Promise<RollApiKeyResponse> {
  const data = await request<RollApiKeyResponse>({
    url: `${API_KEYS_BASE}/${id}/roll`,
    method: "POST",
  })
  return RollApiKeyResponseSchema.parse(data)
}

export async function deleteApiKey(id: string): Promise<void> {
  await request<void>({
    url: `${API_KEYS_BASE}/${id}`,
    method: "DELETE",
  })
}

// =====================
// Utility Functions
// =====================

/**
 * Generate a deterministic color from a string (for identicons)
 */
export function generateKeyColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash)
  }

  const hue = Math.abs(hash % 360)
  return `hsl(${hue}, 70%, 60%)`
}

/**
 * Format relative time (e.g., "2 mins ago")
 */
export function formatRelativeTime(dateString: string | null): string | null {
  if (!dateString) return null

  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return `${diffSecs}s`
  if (diffMins < 60) return `${diffMins}m`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 30) return `${diffDays}d`

  return date.toLocaleDateString()
}

/**
 * Calculate budget usage percentage
 */
export function calculateBudgetPercentage(used: number, limit: number | null): number {
  if (!limit || limit === 0) return 0
  return Math.min(100, (used / limit) * 100)
}

/**
 * Get status color class based on API key status
 */
export function getStatusColor(status: ApiKeyStatus): {
  bg: string
  glow: string
  text: string
} {
  switch (status) {
    case "active":
      return {
        bg: "bg-emerald-500",
        glow: "shadow-[0_0_8px_2px_rgba(16,185,129,0.4)]",
        text: "text-emerald-500",
      }
    case "limited":
      return {
        bg: "bg-amber-500",
        glow: "shadow-[0_0_8px_2px_rgba(245,158,11,0.4)]",
        text: "text-amber-500",
      }
    case "revoked":
    case "expired":
      return {
        bg: "bg-red-500",
        glow: "shadow-[0_0_8px_2px_rgba(239,68,68,0.4)]",
        text: "text-red-500",
      }
    default:
      return {
        bg: "bg-gray-500",
        glow: "shadow-[0_0_8px_2px_rgba(107,114,128,0.4)]",
        text: "text-gray-500",
      }
  }
}
