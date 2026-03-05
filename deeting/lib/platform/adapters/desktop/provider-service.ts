import { invoke } from "@tauri-apps/api/core";

import type { IProviderService } from "../../core/types";
import * as providerApi from "@/lib/api/providers";
import type {
  ProviderInstanceCreate,
  ProviderInstanceResponse,
  ProviderInstanceUpdate,
  ProviderModelResponse,
  ProviderModelPurchaseStatus,
  ProviderModelTestRequest,
  ProviderModelTestResponse,
  ProviderModelUpdate,
  ProviderVerifyRequest,
  ProviderVerifyResponse,
} from "@/lib/api/providers";

import { toHubResponse, toInstanceResponse, toModelResponse } from "./mappers";
import type {
  LocalProviderInstance,
  LocalProviderModel,
  LocalProviderPreset,
} from "./types";

async function syncPresetsFromCloud(params?: {
  category?: string;
  q?: string;
  include_public?: boolean;
}) {
  const cloudHub = await providerApi.fetchProviderHub({
    ...params,
    include_public: params?.include_public ?? true,
  });

  const presets: LocalProviderPreset[] = cloudHub.providers.map((provider) => ({
    slug: provider.slug,
    name: provider.name,
    provider: provider.provider,
    base_url: provider.base_url ?? "",
    icon: provider.icon ?? null,
    is_active: true,
  }));

  await invoke<number>("replace_local_provider_presets", { presets });
}

async function listLocalPresets() {
  return await invoke<LocalProviderPreset[]>("list_local_provider_presets");
}

async function listLocalInstances() {
  return await invoke<LocalProviderInstance[]>("list_local_provider_instances");
}

export const desktopProviderService: IProviderService = {
  getHub: async (params) => {
    try {
      await syncPresetsFromCloud(params);
    } catch (error) {
      console.warn("[desktop-provider] sync presets from cloud failed", error);
    }

    const [presets, instances] = await Promise.all([listLocalPresets(), listLocalInstances()]);

    const hub = toHubResponse(presets, instances);
    const query = params?.q?.trim().toLowerCase();
    if (!query) {
      return hub;
    }

    return {
      ...hub,
      providers: hub.providers.filter((provider) => {
        return (
          provider.name.toLowerCase().includes(query) ||
          provider.slug.toLowerCase().includes(query) ||
          provider.provider.toLowerCase().includes(query)
        );
      }),
    };
  },
  getDetail: async (slug) => {
    let presets = await listLocalPresets();
    let preset = presets.find((item) => item.slug === slug);

    if (!preset) {
      try {
        await syncPresetsFromCloud({ include_public: true });
        presets = await listLocalPresets();
        preset = presets.find((item) => item.slug === slug);
      } catch (error) {
        console.warn("[desktop-provider] fallback sync preset detail failed", error);
      }
    }

    if (preset) {
      return {
        slug: preset.slug,
        name: preset.name,
        provider: preset.provider,
        category: "cloud",
        description: null,
        icon: preset.icon ?? null,
        theme_color: null,
        base_url: preset.base_url || null,
        url_template: null,
        tags: [],
        capabilities: [],
        is_popular: false,
        sort_order: 0,
        connected: false,
        instances: [],
      };
    }

    // Last fallback: direct cloud fetch.
    return providerApi.fetchProviderDetail(slug);
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
