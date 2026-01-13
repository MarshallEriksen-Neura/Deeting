import useSWR from "swr"
import { 
  fetchProviderHub, 
  fetchProviderDetail,
  verifyProvider,
  createProviderInstance,
  updateProviderInstance,
  deleteProviderInstance,
  fetchProviderInstances,
  fetchProviderModels,
  syncProviderModels,
  type ProviderHubResponse,
  type ProviderCard,
  type ProviderVerifyRequest,
  type ProviderVerifyResponse,
  type ProviderInstanceCreate,
  type ProviderInstanceUpdate,
  type ProviderInstanceResponse,
  type ProviderModelResponse
} from "@/lib/api/providers"
import { type ApiError } from "@/lib/http/client"

const EMPTY_ARRAY: any[] = []

export const PROVIDERS_HUB_KEY = "providers/hub"
export const PROVIDER_DETAIL_KEY = "providers/detail"
export const PROVIDER_INSTANCES_KEY = "providers/instances"
export const PROVIDER_MODELS_KEY = "providers/models"

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
    providers: data?.providers || EMPTY_ARRAY,
    stats: data?.stats,
    isLoading,
    isError: !!error,
    error,
    isValidating,
    mutate,
  }
}

// Provider Detail Hook
export function useProviderDetail(slug: string | null) {
  const queryKey = slug ? [PROVIDER_DETAIL_KEY, slug] : null
  
  const { data, error, isLoading, isValidating, mutate } = useSWR<ProviderCard, ApiError>(
    queryKey,
    () => slug ? fetchProviderDetail(slug) : null,
    {
      revalidateOnFocus: false,
      dedupingInterval: 300000, // 5 minutes - provider details change less frequently
    }
  )

  return {
    data,
    isLoading,
    isError: !!error,
    error,
    isValidating,
    mutate,
  }
}

// Provider Instances Hook
export function useProviderInstances(params?: {
  include_public?: boolean
}) {
  const queryKey = [PROVIDER_INSTANCES_KEY, params]
  
  const { data, error, isLoading, isValidating, mutate } = useSWR<ProviderInstanceResponse[], ApiError>(
    queryKey,
    () => fetchProviderInstances(params),
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000, // 30 seconds - instances change more frequently
    }
  )

  return {
    data: data || EMPTY_ARRAY,
    instances: data || EMPTY_ARRAY,
    isLoading,
    isError: !!error,
    error,
    isValidating,
    mutate,
  }
}

// Provider Models Hook
export function useProviderModels(instanceId: string | null) {
  const queryKey = instanceId ? [PROVIDER_MODELS_KEY, instanceId] : null
  
  const { data, error, isLoading, isValidating, mutate } = useSWR<ProviderModelResponse[], ApiError>(
    queryKey,
    () => instanceId ? fetchProviderModels(instanceId) : null,
    {
      revalidateOnFocus: false,
      dedupingInterval: 120000, // 2 minutes - models change occasionally
    }
  )

  return {
    data: data || EMPTY_ARRAY,
    models: data || EMPTY_ARRAY,
    isLoading,
    isError: !!error,
    error,
    isValidating,
    mutate,
  }
}

// Provider Verify Hook (for mutations)
export function useProviderVerify() {
  const verify = async (payload: ProviderVerifyRequest): Promise<ProviderVerifyResponse> => {
    return await verifyProvider(payload)
  }

  return {
    verify,
  }
}

// Provider Instance Creation Hook (for mutations)
export function useCreateProviderInstance() {
  const create = async (payload: ProviderInstanceCreate): Promise<ProviderInstanceResponse> => {
    return await createProviderInstance(payload)
  }

  return {
    create,
  }
}

// Provider Instance Update Hook (for mutations)
export function useUpdateProviderInstance() {
  const update = async (instanceId: string, payload: ProviderInstanceUpdate): Promise<ProviderInstanceResponse> => {
    return await updateProviderInstance(instanceId, payload)
  }

  return {
    update,
  }
}

// Provider Instance Delete Hook (for mutations)
export function useDeleteProviderInstance() {
  const remove = async (instanceId: string): Promise<void> => {
    await deleteProviderInstance(instanceId)
  }

  return {
    remove,
  }
}

// Provider Models Sync Hook (for mutations)
export function useSyncProviderModels() {
  const sync = async (instanceId: string): Promise<ProviderModelResponse[]> => {
    return await syncProviderModels(instanceId)
  }

  return {
    sync,
  }
}
