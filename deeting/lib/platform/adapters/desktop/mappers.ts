import type {
  ProviderCard,
  ProviderHubResponse,
  ProviderInstanceResponse,
  ProviderModelResponse,
} from "@/lib/api/providers";

import type {
  LocalProviderInstance,
  LocalProviderModel,
  LocalProviderPreset,
} from "./types";

function readMetaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  const raw = meta?.[key];
  return typeof raw === "string" && raw.trim() ? raw : null;
}

function readMetaBool(meta: Record<string, unknown> | null | undefined, key: string): boolean | null {
  const raw = meta?.[key];
  return typeof raw === "boolean" ? raw : null;
}

export function toInstanceResponse(instance: LocalProviderInstance): ProviderInstanceResponse {
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
    // Desktop local mode cannot infer keychain presence from credentials_ref alone.
    has_credentials: undefined,
  };
}

export function toModelResponse(model: LocalProviderModel): ProviderModelResponse {
  const response = {
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
  return response;
}

export function toHubResponse(
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
