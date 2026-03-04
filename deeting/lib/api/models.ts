import { z } from "zod"

import { request } from "@/lib/http"

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
  extra_meta?: Record<string, unknown> | null
}

const hasCapability = (model: LocalProviderModel, capability?: string) => {
  const target = capability?.trim().toLowerCase()
  if (!target) return true
  const capabilities = Array.isArray(model.capabilities) ? model.capabilities : []
  return capabilities.some((item) => String(item || "").trim().toLowerCase() === target)
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

async function fetchDesktopLocalModels(options?: {
  capability?: string
}): Promise<ModelListResponse> {
  const instances = await invokeTauri<LocalProviderInstance[]>("list_local_provider_instances")
  const enabled = instances.filter((instance) => instance.is_enabled !== false)
  if (enabled.length === 0) {
    return { instances: [] }
  }

  const modelsByInstance = await Promise.all(
    enabled.map(async (instance) => {
      const models = await invokeTauri<LocalProviderModel[]>("list_local_provider_models", {
        instanceId: instance.id,
      })
      return { instance, models }
    })
  )

  const groups = modelsByInstance
    .map(({ instance, models }) => {
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
