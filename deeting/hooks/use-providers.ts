import useSWR from "swr"
import { usePlatform } from "@/lib/platform/provider"
import { type ApiError } from "@/lib/http/client"
import {
  type ProviderHubResponse,
  type ProviderCard,
  type ProviderVerifyRequest,
  type ProviderVerifyResponse,
  type ProviderInstanceCreate,
  type ProviderInstanceUpdate,
  type ProviderInstanceResponse,
  type ProviderModelResponse,
  type ProviderModelUpdate,
  type ProviderModelTestRequest,
  type ProviderModelTestResponse
} from "@/lib/api/providers"

const EMPTY_ARRAY: never[] = []

export const PROVIDERS_HUB_KEY = "providers/hub"
export const PROVIDER_DETAIL_KEY = "providers/detail"
export const PROVIDER_INSTANCES_KEY = "providers/instances"
export const PROVIDER_MODELS_KEY = "providers/models"

export function useProviderHub(params?: {
  category?: string
  q?: string
  include_public?: boolean
}) {
  const { provider } = usePlatform()
  const queryKey = [PROVIDERS_HUB_KEY, params]
  
  const { data, error, isLoading, isValidating, mutate } = useSWR<ProviderHubResponse, ApiError>(
    queryKey,
    () => provider.getHub(params),
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
  const { provider } = usePlatform()
  const queryKey = slug ? [PROVIDER_DETAIL_KEY, slug] : null
  
  const { data, error, isLoading, isValidating, mutate } = useSWR<ProviderCard, ApiError>(
    queryKey,
    slug ? () => provider.getDetail(slug) : null,
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
  const { provider } = usePlatform()
  const queryKey = [PROVIDER_INSTANCES_KEY, params]
  
  const { data, error, isLoading, isValidating, mutate } = useSWR<ProviderInstanceResponse[], ApiError>(
    queryKey,
    () => provider.getInstances(params),
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
  const { provider } = usePlatform()
  const queryKey = instanceId ? [PROVIDER_MODELS_KEY, instanceId] : null
  
  const { data, error, isLoading, isValidating, mutate } = useSWR<ProviderModelResponse[], ApiError>(
    queryKey,
    instanceId ? () => provider.getModels(instanceId) : null,
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
  const { provider } = usePlatform()
  
  const verify = async (payload: ProviderVerifyRequest): Promise<ProviderVerifyResponse> => {
    return await provider.verify(payload)
  }

  return {
    verify,
  }
}

// Provider Instance Creation Hook (for mutations)
export function useCreateProviderInstance() {
  const { provider } = usePlatform()

  const create = async (payload: ProviderInstanceCreate): Promise<ProviderInstanceResponse> => {
    return await provider.createInstance(payload)
  }

  return {
    create,
  }
}

// Provider Instance Update Hook (for mutations)
export function useUpdateProviderInstance() {
  const { provider } = usePlatform()

  const update = async (instanceId: string, payload: ProviderInstanceUpdate): Promise<ProviderInstanceResponse> => {
    return await provider.updateInstance(instanceId, payload)
  }

  return {
    update,
  }
}

// Provider Instance Delete Hook (for mutations)
export function useDeleteProviderInstance() {
  const { provider } = usePlatform()

  const remove = async (instanceId: string): Promise<void> => {
    return await provider.deleteInstance(instanceId)
  }

  return {
    remove,
  }
}

// Provider Models Sync Hook (for mutations)
export function useSyncProviderModels() {
  const { provider } = usePlatform()

  const sync = async (
    instanceId: string,
    options?: { preserve_user_overrides?: boolean }
  ): Promise<ProviderModelResponse[]> => {
    return await provider.syncModels(instanceId, options)
  }

  return {
    sync,
  }
}

// Provider Model Update Hook
export function useUpdateProviderModel() {
  const { provider } = usePlatform()

  const update = async (
    modelId: string,
    payload: ProviderModelUpdate
  ): Promise<ProviderModelResponse> => {
    return await provider.updateModel(modelId, payload)
  }

  return { update }
}

// Provider Model Test Hook
export function useTestProviderModel() {
  const { provider } = usePlatform()

  const test = async (
    modelId: string,
    payload?: ProviderModelTestRequest
  ): Promise<ProviderModelTestResponse> => {
    return await provider.testModel(modelId, payload)
  }

  return { test }
}