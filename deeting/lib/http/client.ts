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

export function setAuthToken(token: string | null) {
  authToken = token
}

export function clearAuthToken() {
  authToken = null
}

export function getAuthToken() {
  return authToken
}

const apiBaseURL = process.env.NEXT_PUBLIC_API_BASE_URL || "/api"

const apiClient: AxiosInstance = axios.create({
  baseURL: apiBaseURL,
  timeout: 15000,
  withCredentials: true,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
})

apiClient.interceptors.request.use((config) => {
  const headers = config.headers ?? {}

  // 尝试从内存获取，若失败且在客户端环境，尝试从 storage 恢复（防止 SWR 请求早于 hydration）
  if (!authToken && typeof window !== "undefined") {
    try {
      const stored = sessionStorage.getItem("deeting-auth-store")
      if (stored) {
        const parsed = JSON.parse(stored)
        const token = parsed.state?.accessToken
        if (token) {
          authToken = token
        }
      }
    } catch (e) {
      // ignore json parse error
    }
  }

  if (authToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${authToken}`
  }

  return {
    ...config,
    headers,
  }
})

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => Promise.reject(toApiError(error))
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
