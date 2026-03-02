import { invoke } from "@tauri-apps/api/core";

import { IPlatform } from "../../core/types";
import * as providerApi from "@/lib/api/providers";
import * as apiKeyApi from "@/lib/api/api-keys";
import type {
  ProviderCard,
  ProviderHubResponse,
  ProviderInstanceCreate,
  ProviderInstanceResponse,
  ProviderInstanceUpdate,
  ProviderModelResponse,
  ProviderModelTestRequest,
  ProviderModelTestResponse,
  ProviderModelUpdate,
  ProviderVerifyRequest,
  ProviderVerifyResponse,
} from "@/lib/api/providers";

type LocalProviderPreset = {
  slug: string;
  name: string;
  provider: string;
  base_url: string;
  icon?: string | null;
  is_active: boolean;
};

type LocalProviderInstance = {
  id: string;
  preset_slug: string;
  name: string;
  base_url: string;
  is_enabled: boolean;
  is_local: boolean;
  credentials_ref: string;
  created_at: string;
  updated_at: string;
};

type LocalProviderModel = {
  id: string;
  instance_id: string;
  model_id: string;
  display_name?: string | null;
  capabilities: string[];
  is_active: boolean;
};

function toInstanceResponse(instance: LocalProviderInstance): ProviderInstanceResponse {
  return {
    id: instance.id,
    user_id: null,
    preset_slug: instance.preset_slug,
    name: instance.name,
    description: null,
    base_url: instance.base_url,
    protocol: null,
    auto_append_v1: null,
    icon: null,
    theme_color: null,
    priority: 0,
    is_enabled: instance.is_enabled,
    created_at: instance.created_at,
    updated_at: instance.updated_at,
    health_status: "unknown",
    latency_ms: 0,
    sparkline: [],
    model_count: 0,
    has_credentials: Boolean(instance.credentials_ref),
  };
}

function toModelResponse(model: LocalProviderModel): ProviderModelResponse {
  return {
    id: model.id,
    instance_id: model.instance_id,
    capabilities: model.capabilities ?? [],
    model_id: model.model_id,
    unified_model_id: model.model_id,
    display_name: model.display_name ?? null,
    upstream_path: "/v1/chat/completions",
    pricing_config: {},
    limit_config: {},
    tokenizer_config: {},
    routing_config: {},
    config_override: {},
    source: "local",
    extra_meta: {},
    weight: 100,
    priority: 0,
    is_active: model.is_active,
    synced_at: null,
    created_at: null,
    updated_at: null,
  };
}

function toHubResponse(
  presets: LocalProviderPreset[],
  instances: LocalProviderInstance[]
): ProviderHubResponse {
  const cards: ProviderCard[] = presets.map((preset) => {
    const related = instances.filter((instance) => instance.preset_slug === preset.slug);
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
      connected: related.length > 0,
      instances: related.map((instance) => ({
        id: instance.id,
        name: instance.name,
        is_enabled: instance.is_enabled,
        health_status: "unknown",
        latency_ms: 0,
      })),
    };
  });

  return {
    providers: cards,
    stats: {
      total: cards.length,
      connected: cards.filter((card) => card.connected).length,
      by_category: cards.reduce<Record<string, number>>((acc, card) => {
        acc[card.category] = (acc[card.category] ?? 0) + 1;
        return acc;
      }, {}),
    },
  };
}

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

export const desktopPlatform: IPlatform = {
  env: "desktop",

  model: {
    connect: async (id) => {
      console.log("Desktop: Connecting provider", id);
    },
    getList: async () => {
      return [];
    },
  },

  provider: {
    getHub: async (params) => {
      try {
        await syncPresetsFromCloud(params);
      } catch (error) {
        console.warn("[desktop-provider] sync presets from cloud failed", error);
      }

      const [presets, instances] = await Promise.all([
        listLocalPresets(),
        listLocalInstances(),
      ]);

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
    verify: (payload: ProviderVerifyRequest): Promise<ProviderVerifyResponse> =>
      providerApi.verifyProvider(payload),
    createInstance: async (
      payload: ProviderInstanceCreate
    ): Promise<ProviderInstanceResponse> => {
      const created = await invoke<LocalProviderInstance>(
        "create_local_provider_instance",
        {
          payload: {
            preset_slug: payload.preset_slug,
            name: payload.name,
            base_url: payload.base_url,
            is_local: true,
            secret_key: payload.api_key ?? undefined,
          },
        }
      );
      return toInstanceResponse(created);
    },
    getInstances: async (): Promise<ProviderInstanceResponse[]> => {
      const instances = await listLocalInstances();
      return instances.map(toInstanceResponse);
    },
    updateInstance: async (
      id: string,
      payload: ProviderInstanceUpdate
    ): Promise<ProviderInstanceResponse> => {
      const updated = await invoke<LocalProviderInstance>(
        "update_local_provider_instance",
        {
          instance_id: id,
          payload: {
            name: payload.name ?? undefined,
            base_url: payload.base_url ?? undefined,
            is_enabled: payload.is_enabled ?? undefined,
            secret_key: payload.api_key ?? undefined,
          },
        }
      );
      return toInstanceResponse(updated);
    },
    deleteInstance: async (id: string): Promise<void> => {
      await invoke("delete_local_provider_instance", { instance_id: id });
    },
    getModels: async (instanceId: string): Promise<ProviderModelResponse[]> => {
      const models = await invoke<LocalProviderModel[]>("list_local_provider_models", {
        instance_id: instanceId,
      });
      return models.map(toModelResponse);
    },
    syncModels: async (instanceId: string): Promise<ProviderModelResponse[]> => {
      const models = await invoke<LocalProviderModel[]>("sync_local_provider_models", {
        instance_id: instanceId,
      });
      return models.map(toModelResponse);
    },
    quickAddModels: async (
      instanceId: string,
      payload: { models: string[]; capability?: string }
    ): Promise<ProviderModelResponse[]> => {
      const models = await invoke<LocalProviderModel[]>("quick_add_local_provider_models", {
        instance_id: instanceId,
        payload,
      });
      return models.map(toModelResponse);
    },
    updateModel: async (modelId: string, payload: ProviderModelUpdate): Promise<ProviderModelResponse> => {
      const updated = await invoke<LocalProviderModel>("update_local_provider_model", {
        model_id: modelId,
        payload,
      });
      return toModelResponse(updated);
    },
    testModel: async (
      modelId: string,
      payload?: ProviderModelTestRequest
    ): Promise<ProviderModelTestResponse> => {
      return await invoke<ProviderModelTestResponse>("test_local_provider_model", {
        model_id: modelId,
        payload,
      });
    },
  },

  apiKey: {
    list: apiKeyApi.fetchApiKeys,
    getById: apiKeyApi.fetchApiKeyById,
    create: apiKeyApi.createApiKey,
    update: apiKeyApi.updateApiKey,
    revoke: apiKeyApi.revokeApiKey,
    roll: apiKeyApi.rollApiKey,
    delete: apiKeyApi.deleteApiKey,
  },

  app: {
    quit: async () => {
      console.log("Desktop: Quit app");
    },
    openExternal: async (url) => {
      console.log("Desktop: Open external", url);
    },
  },
};
