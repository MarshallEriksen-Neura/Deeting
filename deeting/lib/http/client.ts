import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios"

export interface ApiErrorOptions {
  status?: number
  code?: string
  data?: unknown
  requestId?: string
}

export class ApiError extends Error {
  status?: number
  code?: string
  data?: unknown
  requestId?: string

  constructor(message: string, options: ApiErrorOptions = {}) {
    super(message)
    this.name = "ApiError"
    Object.assign(this, options)
  }
}

let authToken: string | null = null

function loadAuthTokenFromStorage() {
  if (typeof window === "undefined") return null
  try {
    const stored = sessionStorage.getItem("deeting-auth-store")
    if (!stored) return null
    const parsed = JSON.parse(stored)
    return parsed.state?.accessToken ?? null
  } catch {
    return null
  }
}

type RefreshableAxiosRequestConfig = AxiosRequestConfig & {
  /** 内部标记：避免在刷新请求或重放请求中重复触发刷新逻辑 */
  skipAuthRefresh?: boolean
}

const REFRESH_PATH = "/api/v1/auth/refresh"

interface TokenPairResponse {
  access_token: string
  refresh_token?: string
  token_type: "bearer"
}

let refreshPromise: Promise<string | null> | null = null

export function setAuthToken(token: string | null) {
  authToken = token
}

export function clearAuthToken() {
  authToken = null
}

export function getAuthToken() {
  if (authToken) return authToken
  const stored = loadAuthTokenFromStorage()
  if (stored) {
    authToken = stored
  }
  return authToken
}

/**
 * 基于环境的 baseURL 选择：
 * - 优先使用 NEXT_PUBLIC_API_BASE_URL（可指向网关域名）
 * - 开发环境且前端跑在 3000 端口时，自动指向本机 8000 端口后端
 * - 其他场景回落到相对路径 /api（使用 Next 反向代理）
 */
// 仅通过环境变量控制后端地址；未配置时走 Next 反向代理 `/api`
const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === 'true'

// In Tauri dev, we point to localhost:8000 (Python).
// In Tauri prod, this should point to your real production API.
// For now, we assume localhost:8000 for desktop dev.
const envApiUrl = process.env.NEXT_PUBLIC_API_BASE_URL

const desktopBaseURL = envApiUrl || "http://localhost:8000"
// If env var is set, use it. Otherwise use empty string to allow relative paths like /api/v1/...
// which will work with Next.js rewrites if configured, or just hit the current domain.
// Previous value "/api" caused double prefix (/api/api/v1/...) because our API definitions include /api.
const webBaseURL = envApiUrl || ""

const apiBaseURL = isTauri ? desktopBaseURL : webBaseURL

export function resolveApiBaseUrl() {
  if (apiBaseURL) return apiBaseURL
  if (typeof window !== "undefined") return window.location.origin
  return ""
}

export function buildApiWsUrl(
  path: string,
  params?: Record<string, string>
) {
  const baseUrl = resolveApiBaseUrl() || "http://localhost:8000"
  const url = new URL(baseUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = path
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

const apiClient: AxiosInstance = axios.create({
  baseURL: apiBaseURL,
  timeout: 15000,
  withCredentials: true,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
})

// Initialize Tauri Adapter if needed
if (isTauri && typeof window !== 'undefined') {
  // We use an IIFE to async inject the adapter
  (async () => {
    try {
       const { createTauriAdapter } = await import('./tauri-adapter');
       const adapter = await createTauriAdapter();
       apiClient.defaults.adapter = adapter;
       console.log('✅ Tauri HTTP Adapter attached');
    } catch (e) {
       console.error('Failed to load Tauri adapter', e);
    }
  })();
}

apiClient.interceptors.request.use((config) => {
  const headers = config.headers ?? {}

  // 尝试从内存获取，若失败且在客户端环境，尝试从 storage 恢复（防止 SWR 请求早于 hydration）
  const token = getAuthToken()
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`
  }

  return {
    ...config,
    headers,
  }
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status
    const originalConfig = (error.config ?? {}) as RefreshableAxiosRequestConfig
    const requestUrl = originalConfig.url || ""

    const isRefreshRequest =
      requestUrl === REFRESH_PATH ||
      requestUrl?.endsWith("/auth/refresh") ||
      originalConfig.skipAuthRefresh

    if (status === 401 && !isRefreshRequest) {
      try {
        const newToken = await refreshAccessToken()
        if (newToken) {
          const headers = { ...(originalConfig.headers ?? {}) }
          headers.Authorization = `Bearer ${newToken}`
          return apiClient.request({
            ...originalConfig,
            headers,
            skipAuthRefresh: true,
          } as RefreshableAxiosRequestConfig)
        }
      } catch {
        // fall through to ApiError
      }
    }

    return Promise.reject(toApiError(error))
  }
)

function toApiError(error: AxiosError) {
  if (!error.isAxiosError) {
    return new ApiError(error.message)
  }

  const response = error.response as AxiosResponse | undefined
  const message =
    (response?.data as { message?: string } | undefined)?.message ||
    error.message ||
    "请求失败"

  return new ApiError(message, {
    status: response?.status,
    code: error.code,
    data: response?.data,
    requestId:
      (response?.headers?.["x-request-id"] as string | undefined) ||
      (response?.headers?.["x-requestid"] as string | undefined),
  })
}

export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await apiClient.post<TokenPairResponse>(
          REFRESH_PATH,
          undefined,
          { skipAuthRefresh: true } as RefreshableAxiosRequestConfig
        )
        const token = response.data.access_token
        if (token) {
          setAuthToken(token)
          persistAccessToken(token)
          return token
        }
        return null
      } finally {
        refreshPromise = null
      }
    })()
  }
  return refreshPromise
}

function persistAccessToken(token: string) {
  if (typeof window === "undefined") return
  const key = "deeting-auth-store"
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return
    const parsed = JSON.parse(raw)
    const prevState = parsed.state ?? {}
    parsed.state = {
      ...prevState,
      accessToken: token,
      tokenType: prevState.tokenType || "bearer",
      isAuthenticated: Boolean(token),
    }
    sessionStorage.setItem(key, JSON.stringify(parsed))
  } catch {
    // ignore storage errors
  }
}

export async function request<T = unknown>(
  config: AxiosRequestConfig
): Promise<T> {
  const response = await apiClient.request<T>({
    method: "GET",
    ...config,
  })

  return response.data
}

export { apiClient }
