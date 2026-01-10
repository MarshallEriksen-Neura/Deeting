import type { AxiosRequestConfig } from "axios"
import type { SWRConfiguration, SWRResponse } from "swr"
import { apiClient, request, ApiError } from "@/lib/http/client"

export type SWRKey =
  | string
  | [string, AxiosRequestConfig?]
  | null
  | undefined

export const swrFetcher = async <T = unknown>(key: SWRKey): Promise<T> => {
  if (!key) {
    throw new ApiError("缺少请求 key")
  }

  const [url, config] = Array.isArray(key) ? key : [key, undefined]

  if (!url) {
    throw new ApiError("缺少请求地址")
  }

  const response = await apiClient.request<T>({
    url,
    method: config?.method ?? "GET",
    ...config,
  })

  return response.data
}

export const defaultSWRConfig: SWRConfiguration = {
  fetcher: swrFetcher,
  shouldRetryOnError: (error) => {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) return false
      if (error.status === 429) return true
      if (!error.status || error.status >= 500) return true
      return false
    }
    return true
  },
  errorRetryCount: 2,
  revalidateOnFocus: true,
  dedupingInterval: 2000,
}

export type SWRResult<T, E = ApiError> = SWRResponse<T, E>

export { request }
