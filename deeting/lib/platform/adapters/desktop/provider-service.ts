import { invoke } from "@tauri-apps/api/core";

import type { IProviderService } from "../../core/types";
import * as providerApi from "@/lib/api/providers";
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
  ProviderVerifyRequest,
  ProviderVerifyResponse,
} from "@/lib/api/providers";

import { toInstanceResponse, toModelResponse } from "./mappers";
import type {
  LocalProviderInstance,
  LocalProviderModel,
} from "./types";

async function listLocalInstances() {
  return await invoke<LocalProviderInstance[]>("list_local_provider_instances");
}

function toLocalInstanceSummary(instance: LocalProviderInstance) {
  return {
    id: instance.id,
    name: instance.name,
    is_enabled: instance.is_enabled,
    health_status: "unknown",
    latency_ms: 0,
  };
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

function mergeProviderCardWithLocalInstances(
  card: ProviderCard,
  instances: LocalProviderInstance[]
): ProviderCard {
  const relatedInstances = instances.filter((instance) => instance.preset_slug === card.slug);
  return {
    ...card,
    connected: relatedInstances.length > 0,
    instances: relatedInstances.map(toLocalInstanceSummary),
  };
}

function mergeHubWithLocalInstances(
  hub: ProviderHubResponse,
  instances: LocalProviderInstance[]
): ProviderHubResponse {
  const providers = hub.providers.map((provider) =>
    mergeProviderCardWithLocalInstances(provider, instances)
  );

  return {
    providers,
    stats: buildHubStats(providers),
  };
}

export const desktopProviderService: IProviderService = {
  getHub: async (params) => {
    const [hub, instances] = await Promise.all([
      providerApi.fetchProviderHub(params),
      listLocalInstances(),
    ]);

    return mergeHubWithLocalInstances(hub, instances);
  },
  getDetail: async (slug) => {
    const [detail, instances] = await Promise.all([
      providerApi.fetchProviderDetail(slug),
      listLocalInstances(),
    ]);

    return mergeProviderCardWithLocalInstances(detail, instances);
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
