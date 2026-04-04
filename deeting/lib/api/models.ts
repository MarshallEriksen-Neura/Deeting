import { z } from "zod"

import { request } from "@/lib/http"
import { modelSupportsCapability } from "@/lib/providers/model-capabilities"

const MODELS_BASE = "/api/v1/internal/models"
const AVAILABLE_MODELS_PATH = "/api/v1/models/available"

const isTauriRuntime = () => {
  if (typeof window === "undefined") return false
  if ("__TAURI_INTERNALS__" in window || "__TAURI__" in window) return true
  return process.env.NEXT_PUBLIC_IS_TAURI === "true"
}

const shouldIncludeCloudModelsInDesktop = () =>
  process.env.NEXT_PUBLIC_DESKTOP_INCLUDE_CLOUD_MODELS === "true"

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export const ModelInfoSchema = z.object({
  id: z.string(),
  object: z.string().optional(),
  owned_by: z.string().optional(),
  health_status: z.string().nullable().optional(),
  latency_ms: z.number().nullable().optional(),
  icon: z.string().nullable().optional(),
  upstream_model_id: z.string().nullable().optional(),
  provider_model_id: z.string().nullable().optional(),
  input_types: z.array(z.string()).nullable().optional(),
  request_route: z.enum(["local_invoke", "cloud_http"]).optional(),
  runtime_source: z.enum(["desktop_local", "cloud_internal"]).optional(),
  is_platform: z.boolean().optional(),
  pricing: z.record(z.string(), z.unknown()).nullable().optional(),
})

export const ModelListResponseSchema = z.object({
  instances: z.array(
    z.object({
      instance_id: z.string(),
      instance_name: z.string(),
      provider: z.string().optional(),
      icon: z.string().nullable().optional(),
      models: z.array(ModelInfoSchema),
    })
  ),
})
export const AvailableModelsResponseSchema = z.object({
  items: z.array(z.string()),
})

export type ModelInfo = z.infer<typeof ModelInfoSchema>
export type ModelListResponse = z.infer<typeof ModelListResponseSchema>
export type ModelGroup = ModelListResponse["instances"][number]
export type AvailableModelsResponse = z.infer<typeof AvailableModelsResponseSchema>

type ChatSelectableModel = Pick<
  ModelInfo,
  "id" | "provider_model_id" | "request_route" | "runtime_source"
>

type LocalProviderInstance = {
  id: string
  preset_slug?: string
  name: string
  icon?: string | null
  is_enabled?: boolean
}

type LocalProviderModel = {
  id: string
  instance_id: string
  model_id: string
  unified_model_id?: string | null
  capabilities?: string[]
  is_active?: boolean
  routing_config?: Record<string, unknown> | null
  extra_meta?: Record<string, unknown> | null
}

type DesktopLocalModelInventory = {
  enabledInstances: LocalProviderInstance[]
  modelsByInstance: Map<string, LocalProviderModel[]>
}

type DesktopLocalModelInventoryCacheEntry = {
  expiresAt: number
  value: DesktopLocalModelInventory | null
  promise: Promise<DesktopLocalModelInventory> | null
}

const DESKTOP_LOCAL_MODEL_INVENTORY_TTL_MS = 30_000

let desktopLocalModelInventoryCache: DesktopLocalModelInventoryCacheEntry | null = null

const hasCapability = (model: LocalProviderModel, capability?: string) => {
  return modelSupportsCapability({
    capabilities: model.capabilities,
    routingConfig: model.routing_config ?? null,
    extraMeta: model.extra_meta ?? null,
    capability,
  })
}

const markModelRoute = (
  payload: ModelListResponse,
  requestRoute: "local_invoke" | "cloud_http",
  runtimeSource: "desktop_local" | "cloud_internal"
): ModelListResponse => ({
  instances: payload.instances.map((group) => ({
    ...group,
    models: group.models.map((model) => ({
      ...model,
      request_route: requestRoute,
      runtime_source: runtimeSource,
    })),
  })),
})

export function isDesktopLocalModel(model?: Pick<ModelInfo, "request_route" | "runtime_source"> | null) {
  if (!model) return false
  return model.request_route === "local_invoke" || model.runtime_source === "desktop_local"
}

export function resolveChatModelSelectionValue(model: ChatSelectableModel): string {
  return model.provider_model_id ?? model.id
}

export function matchesChatModelSelectionValue(
  model: ChatSelectableModel,
  value?: string | null
): boolean {
  if (!value) return false
  return (
    resolveChatModelSelectionValue(model) === value ||
    model.id === value ||
    model.provider_model_id === value
  )
}

export function invalidateDesktopLocalModelsCache() {
  desktopLocalModelInventoryCache = null
}

async function fetchDesktopLocalModelInventory(): Promise<DesktopLocalModelInventory> {
  const now = Date.now()
  if (
    desktopLocalModelInventoryCache?.value &&
    desktopLocalModelInventoryCache.expiresAt > now
  ) {
    return desktopLocalModelInventoryCache.value
  }

  if (desktopLocalModelInventoryCache?.promise) {
    return desktopLocalModelInventoryCache.promise
  }

  const pending = (async () => {
    const instances = await invokeTauri<LocalProviderInstance[]>("list_local_provider_instances")
    const enabledInstances = instances.filter((instance) => instance.is_enabled !== false)

    if (enabledInstances.length === 0) {
      const emptyInventory: DesktopLocalModelInventory = {
        enabledInstances: [],
        modelsByInstance: new Map(),
      }
      desktopLocalModelInventoryCache = {
        expiresAt: Date.now() + DESKTOP_LOCAL_MODEL_INVENTORY_TTL_MS,
        value: emptyInventory,
        promise: null,
      }
      return emptyInventory
    }

    const modelsByInstanceEntries = await Promise.all(
      enabledInstances.map(async (instance) => {
        const models = await invokeTauri<LocalProviderModel[]>("list_local_provider_models", {
          instanceId: instance.id,
        })
        return [instance.id, Array.isArray(models) ? models : []] as const
      })
    )

    const inventory: DesktopLocalModelInventory = {
      enabledInstances,
      modelsByInstance: new Map(modelsByInstanceEntries),
    }

    desktopLocalModelInventoryCache = {
      expiresAt: Date.now() + DESKTOP_LOCAL_MODEL_INVENTORY_TTL_MS,
      value: inventory,
      promise: null,
    }

    return inventory
  })().catch((error) => {
    desktopLocalModelInventoryCache = null
    throw error
  })

  desktopLocalModelInventoryCache = {
    expiresAt: now + DESKTOP_LOCAL_MODEL_INVENTORY_TTL_MS,
    value: desktopLocalModelInventoryCache?.value ?? null,
    promise: pending,
  }

  return pending
}

async function fetchDesktopLocalModels(options?: {
  capability?: string
}): Promise<ModelListResponse> {
  const { enabledInstances, modelsByInstance } = await fetchDesktopLocalModelInventory()
  if (enabledInstances.length === 0) {
    return { instances: [] }
  }

  const groups = enabledInstances
    .map((instance) => {
      const models = modelsByInstance.get(instance.id) ?? []
      const filteredModels = (Array.isArray(models) ? models : [])
        .filter((model) => model.is_active !== false)
        .filter((model) => hasCapability(model, options?.capability))
      if (filteredModels.length === 0) {
        return null
      }
      return {
        instance_id: instance.id,
        instance_name: instance.name,
        provider: instance.preset_slug ?? "local",
        icon: instance.icon ?? null,
        models: filteredModels.map((model) => {
          const meta = (model.extra_meta && typeof model.extra_meta === "object"
            ? model.extra_meta
            : null) as Record<string, unknown> | null
          const inputTypes = Array.isArray(meta?.input_types)
            ? (meta?.input_types as unknown[])
                .map((item) => String(item))
                .filter((item) => item.trim().length > 0)
            : null
          return {
            id: model.unified_model_id || model.model_id,
            object: "model",
            owned_by: instance.preset_slug ?? "local",
            health_status: "unknown",
            latency_ms: 0,
            icon: instance.icon ?? null,
            upstream_model_id: model.model_id,
            provider_model_id: model.id,
            input_types: inputTypes,
          }
        }),
      }
    })
    .filter((group): group is NonNullable<typeof group> => Boolean(group))

  return markModelRoute({ instances: groups }, "local_invoke", "desktop_local")
}

export async function fetchChatModels(options?: {
  capability?: string
}): Promise<ModelListResponse> {
  const fetchCloudModels = async () => {
    const cloudData = await request({
      url: MODELS_BASE,
      method: "GET",
      params: options?.capability ? { capability: options.capability } : undefined,
    })
    return markModelRoute(ModelListResponseSchema.parse(cloudData), "cloud_http", "cloud_internal")
  }

  if (!isTauriRuntime()) {
    return fetchCloudModels()
  }

  let localPayload: ModelListResponse = { instances: [] }
  try {
    localPayload = await fetchDesktopLocalModels(options)
  } catch (error) {
    console.warn("fetch_local_models_failed", error)
  }

  if (!shouldIncludeCloudModelsInDesktop()) {
    return localPayload
  }

  let cloudPayload: ModelListResponse = { instances: [] }
  try {
    cloudPayload = await fetchCloudModels()
  } catch (error) {
    if (localPayload.instances.length === 0) {
      throw error
    }
    console.warn("fetch_cloud_models_failed", error)
  }

  const merged = [...localPayload.instances, ...cloudPayload.instances]
  return { instances: merged }
}

export async function fetchAvailableModels(): Promise<AvailableModelsResponse> {
  const data = await request({
    url: AVAILABLE_MODELS_PATH,
    method: "GET",
  })
  return AvailableModelsResponseSchema.parse(data)
}
