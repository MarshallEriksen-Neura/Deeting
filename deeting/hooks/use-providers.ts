import useSWR from "swr"
import { fetchProviderHub, type ProviderHubResponse } from "@/lib/api/providers"
import { type ApiError } from "@/lib/http/client"

export const PROVIDERS_HUB_KEY = "providers/hub"

export function useProviderHub(params?: {
  category?: string
  q?: string
  include_public?: boolean
}) {
  const queryKey = [PROVIDERS_HUB_KEY, params]
  
  const { data, error, isLoading, isValidating, mutate } = useSWR<ProviderHubResponse, ApiError>(
    queryKey,
    () => fetchProviderHub(params),
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // 1 minute
    }
  )

  return {
    data,
    providers: data?.providers || [],
    stats: data?.stats,
    isLoading,
    isError: !!error,
    error,
    isValidating,
    mutate,
  }
}
