import { invoke } from "@tauri-apps/api/core";

import type { IProviderService } from "../../core/types";
import type {
  ProviderCard,
  ProviderHubResponse,
  ProviderInstanceCreate,
  ProviderInstanceResponse,
  ProviderInstanceUpdate,
  ProviderModelResponse,
  ProviderModelPurchaseStatus,
  ProviderModelTestRequest,
  ProviderModelTestResponse,
  ProviderModelUpdate,
  ProviderPresetSync,
  ProviderVerifyRequest,
  ProviderVerifyResponse,
} from "@/lib/api/providers";
import { fetchProviderPresetConfigs } from "@/lib/api/providers";

import { toHubResponse, toInstanceResponse, toModelResponse } from "./mappers";
import type {
  LocalProviderInstance,
  LocalProviderModel,
  LocalProviderPreset,
} from "./types";

async function listLocalInstances() {
  return await invoke<LocalProviderInstance[]>("list_local_provider_instances");
}

async function listLocalPresets() {
  return await invoke<LocalProviderPreset[]>("list_local_provider_presets");
}

function toLocalPreset(preset: ProviderPresetSync): LocalProviderPreset {
  return {
    slug: preset.slug,
    name: preset.name,
    provider: preset.provider,
    base_url: preset.base_url ?? "",
    icon: preset.icon ?? null,
    theme_color: preset.theme_color ?? null,
    category: preset.category ?? null,
    url_template: preset.url_template ?? null,
    auth_type: preset.auth_type ?? "api_key",
    auth_config: preset.auth_config ?? {},
    protocol_schema_version: preset.protocol_schema_version ?? null,
    protocol_profiles: preset.protocol_profiles ?? {},
    version: preset.version ?? 1,
    is_active: preset.is_active ?? true,
  };
}

async function syncPresetsFromCloud() {
  const presets = await fetchProviderPresetConfigs();
  await invoke<number>("replace_local_provider_presets", {
    presets: presets.map(toLocalPreset),
  });
}

function buildHubStats(providers: ProviderCard[]): ProviderHubResponse["stats"] {
  return {
    total: providers.length,
    connected: providers.filter((provider) => provider.connected).length,
    by_category: providers.reduce<Record<string, number>>((acc, provider) => {
      const key = (provider.category || "unknown").trim().toLowerCase();
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

function filterLocalHub(
  hub: ProviderHubResponse,
  params?: { category?: string; q?: string; include_public?: boolean }
): ProviderHubResponse {
  const normalizedCategory = params?.category?.trim().toLowerCase() ?? "";
  const normalizedQuery = params?.q?.trim().toLowerCase() ?? "";

  const providers = hub.providers.filter((provider) => {
    if (
      normalizedCategory &&
      (provider.category || "").trim().toLowerCase() !== normalizedCategory
    ) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    const haystack = [
      provider.slug,
      provider.name,
      provider.provider,
      provider.category,
      provider.base_url,
      provider.url_template,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().toLowerCase());

    return haystack.some((value) => value.includes(normalizedQuery));
  });

  return {
    providers,
    stats: buildHubStats(providers),
  };
}

async function buildLocalHub(
  params?: { category?: string; q?: string; include_public?: boolean }
): Promise<ProviderHubResponse> {
  try {
    await syncPresetsFromCloud();
  } catch (error) {
    console.warn("[desktop-provider] sync presets from cloud failed", error);
  }

  const [presets, instances] = await Promise.all([
    listLocalPresets(),
    listLocalInstances(),
  ]);

  return filterLocalHub(toHubResponse(presets, instances), params);
}

export const desktopProviderService: IProviderService = {
  getHub: async (params) => {
    return await buildLocalHub(params);
  },
  getDetail: async (slug) => {
    const hub = await buildLocalHub();
    const detail = hub.providers.find((provider) => provider.slug === slug);
    if (!detail) {
      throw new Error(`provider preset not found: ${slug}`);
    }
    return detail;
  },
  verify: async (payload: ProviderVerifyRequest): Promise<ProviderVerifyResponse> => {
    return await invoke<ProviderVerifyResponse>("verify_local_provider", { payload });
  },
  createInstance: async (payload: ProviderInstanceCreate): Promise<ProviderInstanceResponse> => {
    const created = await invoke<LocalProviderInstance>("create_local_provider_instance", {
      payload: {
        preset_slug: payload.preset_slug,
        name: payload.name,
        base_url: payload.base_url,
        chat_transport_path: payload.chat_transport_path ?? undefined,
        description: payload.description ?? undefined,
        icon: payload.icon ?? undefined,
        priority: payload.priority ?? undefined,
        protocol: payload.protocol ?? undefined,
        model_prefix: payload.model_prefix ?? undefined,
        auto_append_v1: payload.auto_append_v1 ?? undefined,
        resource_name: payload.resource_name ?? undefined,
        deployment_name: payload.deployment_name ?? undefined,
        api_version: payload.api_version ?? undefined,
        project_id: payload.project_id ?? undefined,
        region: payload.region ?? undefined,
        app_id: payload.app_id ?? undefined,
        is_local: true,
        secret_key: payload.api_key ?? undefined,
      },
    });
    return toInstanceResponse(created);
  },
  getInstances: async (): Promise<ProviderInstanceResponse[]> => {
    const instances = await listLocalInstances();
    return instances.map(toInstanceResponse);
  },
  updateInstance: async (id: string, payload: ProviderInstanceUpdate): Promise<ProviderInstanceResponse> => {
    const updated = await invoke<LocalProviderInstance>("update_local_provider_instance", {
      instanceId: id,
      payload: {
        name: payload.name ?? undefined,
        base_url: payload.base_url ?? undefined,
        chat_transport_path: payload.chat_transport_path ?? undefined,
        description: payload.description ?? undefined,
        icon: payload.icon ?? undefined,
        priority: payload.priority ?? undefined,
        protocol: payload.protocol ?? undefined,
        model_prefix: payload.model_prefix ?? undefined,
        auto_append_v1: payload.auto_append_v1 ?? undefined,
        resource_name: payload.resource_name ?? undefined,
        deployment_name: payload.deployment_name ?? undefined,
        api_version: payload.api_version ?? undefined,
        project_id: payload.project_id ?? undefined,
        region: payload.region ?? undefined,
        app_id: payload.app_id ?? undefined,
        is_enabled: payload.is_enabled ?? undefined,
        secret_key: payload.api_key ?? undefined,
      },
    });
    return toInstanceResponse(updated);
  },
  deleteInstance: async (id: string): Promise<void> => {
    await invoke("delete_local_provider_instance", { instanceId: id });
  },
  getModels: async (instanceId: string): Promise<ProviderModelResponse[]> => {
    const models = await invoke<LocalProviderModel[]>("list_local_provider_models", {
      instanceId,
    });
    return models.map(toModelResponse);
  },
  syncModels: async (instanceId: string): Promise<ProviderModelResponse[]> => {
    const models = await invoke<LocalProviderModel[]>("sync_local_provider_models", {
      instanceId,
    });
    return models.map(toModelResponse);
  },
  quickAddModels: async (
    instanceId: string,
    payload: { models: string[]; capability?: string }
  ): Promise<ProviderModelResponse[]> => {
    const models = await invoke<LocalProviderModel[]>("quick_add_local_provider_models", {
      instanceId,
      payload,
    });
    return models.map(toModelResponse);
  },
  updateModel: async (modelId: string, payload: ProviderModelUpdate): Promise<ProviderModelResponse> => {
    const updated = await invoke<LocalProviderModel>("update_local_provider_model", {
      modelId,
      payload,
    });
    return toModelResponse(updated);
  },
  testModel: async (modelId: string, payload?: ProviderModelTestRequest): Promise<ProviderModelTestResponse> => {
    return await invoke<ProviderModelTestResponse>("test_local_provider_model", {
      modelId,
      payload,
    });
  },
  getModelPurchaseStatus: async (
    modelId: string
  ): Promise<ProviderModelPurchaseStatus> => {
    return {
      model_id: modelId,
      unlock_price_credits: null,
      currency: "credits",
      is_purchased: true,
      is_locked: false,
    };
  },
  purchaseModel: async (modelId: string): Promise<ProviderModelPurchaseStatus> => {
    return {
      model_id: modelId,
      unlock_price_credits: null,
      currency: "credits",
      is_purchased: true,
      is_locked: false,
    };
  },
};
