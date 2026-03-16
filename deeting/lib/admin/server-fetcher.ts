/**
 * Admin 服务端数据获取层
 * 用于在 Server Components 中获取数据，配合 Suspense 使用
 */

import {
  fetchAdminUsers,
  fetchAdminApiKeys,
  fetchAdminAssistants,
  fetchAdminConversations,
  fetchAdminGenerationTasks,
  fetchAdminGatewayLogs,
  fetchAdminPendingReviewCounts,
  fetchAdminProviderInstances,
  fetchAdminProviderCredentials,
  fetchAdminProviderPresets,
  fetchAdminSkills,
  fetchAdminNotifications,
  type AdminUserItem,
  type AdminApiKeyItem,
  type AdminAssistantItem,
} from "@/lib/api/admin-dashboard"

import { request } from "@/lib/http"

const ADMIN_BASE = "/api/v1/admin"

/**
 * 用户相关类型
 */
export interface AdminUsersResponse {
  items: AdminUserItem[]
  total: number
  skip: number
  limit: number
}

/**
 * API Key 相关类型
 */
export interface AdminApiKeysResponse {
  items: AdminApiKeyItem[]
  total: number
  skip: number
  limit: number
}

/**
 * Assistant 相关类型
 */
export interface AdminAssistantsResponse {
  items: AdminAssistantItem[]
  total?: number
  next_cursor: string | null
  size?: number
}

/**
 * 服务端获取用户列表
 */
export async function serverFetchAdminUsers(params?: {
  limit?: number
  skip?: number
  is_active?: boolean
  is_superuser?: boolean
  email?: string
}): Promise<AdminUsersResponse> {
  try {
    const result = await fetchAdminUsers({
      limit: params?.limit ?? 100,
      skip: params?.skip ?? 0,
      is_active: params?.is_active,
      is_superuser: params?.is_superuser,
      email: params?.email,
    })
    return {
      items: result.items,
      total: result.total,
      skip: result.skip,
      limit: result.limit,
    }
  } catch (error) {
    console.error("Failed to fetch admin users:", error)
    return {
      items: [],
      total: 0,
      skip: 0,
      limit: 100,
    }
  }
}

/**
 * 服务端获取 API Keys
 */
export async function serverFetchAdminApiKeys(params?: {
  limit?: number
  skip?: number
  status?: string
  type?: string
  user_id?: string
  tenant_id?: string
}): Promise<AdminApiKeysResponse> {
  try {
    const result = await fetchAdminApiKeys({
      limit: params?.limit ?? 100,
      skip: params?.skip ?? 0,
      status: params?.status,
      type: params?.type,
      user_id: params?.user_id,
      tenant_id: params?.tenant_id,
    })
    return {
      items: result.items,
      total: result.total,
      skip: result.skip,
      limit: result.limit,
    }
  } catch (error) {
    console.error("Failed to fetch admin api keys:", error)
    return {
      items: [],
      total: 0,
      skip: 0,
      limit: 100,
    }
  }
}

/**
 * 服务端获取 Assistants
 */
export async function serverFetchAdminAssistants(params?: {
  size?: number
  cursor?: string | null
  status?: string
  visibility?: string
}): Promise<AdminAssistantsResponse> {
  try {
    const result = await fetchAdminAssistants({
      size: params?.size ?? 50,
      cursor: params?.cursor ?? null,
      status: params?.status,
      visibility: params?.visibility,
    })
    return {
      items: result.items,
      total: result.total,
      next_cursor: result.next_cursor ?? null,
      size: result.size,
    }
  } catch (error) {
    console.error("Failed to fetch admin assistants:", error)
    return {
      items: [],
      total: 0,
      next_cursor: null,
      size: 0,
    }
  }
}

/**
 * 服务端获取会话列表
 */
export async function serverFetchAdminConversations(params?: {
  skip?: number
  limit?: number
}) {
  try {
    return await fetchAdminConversations({
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 50,
    })
  } catch (error) {
    console.error("Failed to fetch admin conversations:", error)
    return { items: [], total: 0, skip: 0, limit: 50 }
  }
}

/**
 * 服务端获取生成任务列表
 */
export async function serverFetchAdminGenerationTasks(params?: {
  skip?: number
  limit?: number
}) {
  try {
    return await fetchAdminGenerationTasks({
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 50,
    })
  } catch (error) {
    console.error("Failed to fetch admin generation tasks:", error)
    return { items: [], total: 0, skip: 0, limit: 50 }
  }
}

/**
 * 服务端获取网关日志
 */
export async function serverFetchAdminGatewayLogs(params?: {
  skip?: number
  limit?: number
  model?: string
  status_code?: number
  is_cached?: boolean
}) {
  try {
    return await fetchAdminGatewayLogs({
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 50,
      model: params?.model,
      status_code: params?.status_code,
      is_cached: params?.is_cached,
    })
  } catch (error) {
    console.error("Failed to fetch admin gateway logs:", error)
    return { items: [], total: 0, skip: 0, limit: 50 }
  }
}

/**
 * 服务端获取服务提供商实例
 */
export async function serverFetchAdminProviderInstances() {
  try {
    return await fetchAdminProviderInstances()
  } catch (error) {
    console.error("Failed to fetch admin provider instances:", error)
    return { items: [], total: 0 }
  }
}

/**
 * 服务端获取服务提供商凭据
 */
export async function serverFetchAdminProviderCredentials(instanceId: string) {
  try {
    return await fetchAdminProviderCredentials(instanceId)
  } catch (error) {
    console.error("Failed to fetch admin provider credentials:", error)
    return { items: [], total: 0 }
  }
}

/**
 * 服务端获取服务提供商预设
 */
export async function serverFetchAdminProviderPresets() {
  try {
    return await fetchAdminProviderPresets()
  } catch (error) {
    console.error("Failed to fetch admin provider presets:", error)
    return { items: [], total: 0 }
  }
}

/**
 * 服务端获取技能列表
 */
export async function serverFetchAdminSkills(params?: {
  skip?: number
  limit?: number
}) {
  try {
    return await fetchAdminSkills({
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 50,
    })
  } catch (error) {
    console.error("Failed to fetch admin skills:", error)
    return { items: [], total: 0 }
  }
}

/**
 * 服务端获取通知列表
 */
export async function serverFetchAdminNotifications(params?: {
  skip?: number
  limit?: number
}) {
  try {
    return await fetchAdminNotifications({
      skip: params?.skip ?? 0,
      limit: params?.limit ?? 50,
    })
  } catch (error) {
    console.error("Failed to fetch admin notifications:", error)
    return { items: [], total: 0, skip: 0, limit: 50 }
  }
}

/**
 * 通用服务端数据获取
 * 用于动态获取任意 Admin API 数据
 */
export async function serverFetchAdminData<T>(
  endpoint: string,
  params?: Record<string, unknown>
): Promise<T> {
  try {
    const data = await request<T>({
      url: `${ADMIN_BASE}${endpoint}`,
      method: "GET",
      params: params as Record<string, string | number | boolean | undefined>,
    })
    return data
  } catch (error) {
    console.error(`Failed to fetch admin data from ${endpoint}:`, error)
    throw error
  }
}

/**
 * 获取仪表盘统计数据
 */
export interface DashboardStats {
  traffic: {
    todayRequests: number
    yesterdayRequests: number
    todayTokens: number
    yesterdayTokens: number
  }
  health: {
    successRate: number
    avgLatency: number
    errorRate: number
  }
  financial: {
    monthlySpent: number
    balance: number
    quotaUsedPercent: number
  }
}

export async function serverFetchDashboardStats(): Promise<DashboardStats | null> {
  try {
    const data = await request<{ data: DashboardStats }>({
      url: "/api/v1/admin/dashboard/stats",
    })
    return data.data
  } catch (error) {
    console.error("Failed to fetch dashboard stats:", error)
    return null
  }
}

/**
 * 获取提供商健康状态
 */
export interface ProviderHealth {
  id: string
  name: string
  status: "active" | "up" | "degraded" | "down"
  latency: number
  sparkline: number[]
}

export async function serverFetchProviderHealth(): Promise<ProviderHealth[]> {
  try {
    const data = await request<{ data: ProviderHealth[] }>({
      url: "/api/v1/admin/provider-health",
    })
    return data.data
  } catch (error) {
    console.error("Failed to fetch provider health:", error)
    return []
  }
}

/**
 * 获取最近的错误日志
 */
export interface RecentError {
  id: string
  timestamp: string
  statusCode: number
  model: string
  errorCode: string | null
  errorMessage: string
}

export async function serverFetchRecentErrors(limit = 10): Promise<RecentError[]> {
  try {
    const data = await request<{ data: RecentError[] }>({
      url: "/api/v1/admin/recent-errors",
      params: { limit },
    })
    return data.data
  } catch (error) {
    console.error("Failed to fetch recent errors:", error)
    return []
  }
}

/**
 * 获取待审核数量
 */
export interface PendingReviewCounts {
  knowledge_reviews: number
  plugin_reviews: number
}

export async function serverFetchPendingReviewCounts(): Promise<PendingReviewCounts> {
  try {
    return await fetchAdminPendingReviewCounts()
  } catch (error) {
    console.error("Failed to fetch pending reviews:", error)
    return {
      knowledge_reviews: 0,
      plugin_reviews: 0,
    }
  }
}
