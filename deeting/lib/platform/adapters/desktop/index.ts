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
  theme_color?: string | null;
  category?: string | null;
  url_template?: string | null;
  is_active: boolean;
};

type LocalProviderInstance = {
  id: string;
  preset_slug: string;
  name: string;
  base_url: string;
  description?: string | null;
  icon?: string | null;
  priority?: number;
  meta?: Record<string, unknown> | null;
  is_enabled: boolean;
  is_local: boolean;
  credentials_ref: string;
  created_at: string;
  updated_at: string;
};

type LocalProviderModel = {
  id: string;
  instance_id: string;
  capabilities: string[];
  model_id: string;
  unified_model_id?: string | null;
  display_name?: string | null;
  upstream_path: string;
  pricing_config?: Record<string, unknown> | null;
  limit_config?: Record<string, unknown> | null;
  tokenizer_config?: Record<string, unknown> | null;
  routing_config?: Record<string, unknown> | null;
  config_override?: Record<string, unknown> | null;
  source: string;
  extra_meta?: Record<string, unknown> | null;
  weight?: number;
  priority?: number;
  is_active: boolean;
  synced_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function readMetaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  const raw = meta?.[key];
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function readMetaBool(meta: Record<string, unknown> | null | undefined, key: string): boolean | null {
  const raw = meta?.[key];
  return typeof raw === "boolean" ? raw : null;
}

function toInstanceResponse(instance: LocalProviderInstance): ProviderInstanceResponse {
  return {
    id: instance.id,
    user_id: null,
    preset_slug: instance.preset_slug,
    name: instance.name,
    description: instance.description ?? null,
    base_url: instance.base_url,
    protocol: readMetaString(instance.meta, "protocol"),
    auto_append_v1: readMetaBool(instance.meta, "auto_append_v1"),
    icon: instance.icon ?? null,
    theme_color: null,
    priority: instance.priority ?? 0,
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
    unified_model_id: model.unified_model_id ?? model.model_id,
    display_name: model.display_name ?? null,
    upstream_path: model.upstream_path,
    pricing_config: model.pricing_config ?? {},
    limit_config: model.limit_config ?? {},
    tokenizer_config: model.tokenizer_config ?? {},
    routing_config: model.routing_config ?? {},
    config_override: model.config_override ?? {},
    source: model.source,
    extra_meta: model.extra_meta ?? {},
    weight: model.weight ?? 100,
    priority: model.priority ?? 0,
    is_active: model.is_active,
    synced_at: model.synced_at ?? null,
    created_at: model.created_at ?? null,
    updated_at: model.updated_at ?? null,
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
      try {
        const { exit } = await import("@tauri-apps/plugin-process");
        await exit(0);
      } catch (err) {
        console.error("Desktop: quit failed", err);
      }
    },
    openExternal: async (url) => {
      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
      } catch {
        window.open(url, "_blank");
      }
    },
    minimize: async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().hide();
      } catch (err) {
        console.error("Desktop: minimize failed", err);
      }
    },
    notify: async (title: string, body: string) => {
      try {
        const {
          isPermissionGranted,
          requestPermission,
          sendNotification,
        } = await import("@tauri-apps/plugin-notification");
        let granted = await isPermissionGranted();
        if (!granted) {
          const permission = await requestPermission();
          granted = permission === "granted";
        }
        if (granted) {
          sendNotification({ title, body });
        }
      } catch (err) {
        console.error("Desktop: notify failed", err);
      }
    },
  },
};
