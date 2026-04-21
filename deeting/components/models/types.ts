/**
 * Model Management Types
 */

export type ModelCapability =
  | "chat"
  | "image_generation"
  | "text_to_speech"
  | "speech_to_text"
  | "video_generation"
  | "embedding";

export type ProviderStatus = "online" | "offline" | "degraded" | "syncing" | "unknown";
export type PriceTier = "free" | "cheap" | "moderate" | "expensive" | "premium";

export interface ProviderModel {
  uuid: string;
  id: string;
  object: "model";
  display_name?: string;
  unified_model_id?: string;
  capabilities: ModelCapability[];
  context_window: number;
  pricing: {
    input: number;
    output: number;
  };
  is_active: boolean;
  is_locked?: boolean;
  is_purchased?: boolean;
  unlock_price_credits?: number | null;
  upstream_path?: string;
  request_url?: string;
  weight?: number;
  priority?: number;
  updated_at: string;
  created_at?: string;
  routing_config?: Record<string, unknown>;
  config_override?: Record<string, unknown>;
  family?: string;
  version?: string;
  max_output_tokens?: number;
  rpm?: number;
  tpm?: number;
  max_input_images?: number;
  supports_functions?: boolean;
  supports_json_mode?: boolean;
  deprecated_at?: string;
}

export interface ProviderInstance {
  id: string;
  name: string;
  provider?: string;
  provider_display_name: string;
  preset_slug?: string;
  base_url: string;
  protocol?: string | null;
  auto_append_v1?: boolean | null;
  status?: ProviderStatus;
  latency?: number;
  last_synced_at?: string;
  model_count?: number;
  theme_color?: string;
  icon?: string;
  description?: string;
  is_enabled: boolean;
  is_public?: boolean;
  has_credentials?: boolean;
  health_check_interval?: number;
}

export interface ModelFilterState {
  search: string;
  capabilities: ModelCapability[];
  min_context_window: number | null;
  active_only: boolean;
  price_tier: PriceTier | null;
}

export interface SyncState {
  is_syncing: boolean;
  progress: number;
  last_sync: string | null;
  error: string | null;
}

export interface TestMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  tokens?: number;
  latency?: number;
}

export interface TestSession {
  model_id: string;
  instance_id: string;
  messages: TestMessage[];
  is_loading: boolean;
  error?: string;
}

export const CAPABILITY_META: Record<
  ModelCapability,
  {
    icon: string;
    label: string;
    description: string;
  }
> = {
  chat: {
    icon: "Chat",
    label: "Chat",
    description: "Conversational AI capabilities",
  },
  image_generation: {
    icon: "Image",
    label: "Image Generation",
    description: "Image generation capabilities",
  },
  text_to_speech: {
    icon: "TTS",
    label: "Text to Speech",
    description: "Speech synthesis capabilities",
  },
  speech_to_text: {
    icon: "STT",
    label: "Speech to Text",
    description: "Speech recognition capabilities",
  },
  video_generation: {
    icon: "Video",
    label: "Video Generation",
    description: "Video generation capabilities",
  },
  embedding: {
    icon: "Embed",
    label: "Embedding",
    description: "Text embedding generation",
  },
};

export const CONTEXT_WINDOW_PRESETS = [
  { label: "All", value: null },
  { label: "> 8k", value: 8000 },
  { label: "> 32k", value: 32000 },
  { label: "> 128k", value: 128000 },
  { label: "> 200k", value: 200000 },
] as const;

export const PRICE_TIER_THRESHOLDS: Record<PriceTier, { max: number; color: string }> = {
  free: { max: 0, color: "text-emerald-400" },
  cheap: { max: 1, color: "text-emerald-500" },
  moderate: { max: 5, color: "text-yellow-500" },
  expensive: { max: 15, color: "text-orange-500" },
  premium: { max: Infinity, color: "text-red-500" },
};

export function getPriceTier(inputPrice: number): PriceTier {
  if (inputPrice === 0) return "free";
  if (inputPrice <= 1) return "cheap";
  if (inputPrice <= 5) return "moderate";
  if (inputPrice <= 15) return "expensive";
  return "premium";
}

export function getPriceColor(inputPrice: number): string {
  return PRICE_TIER_THRESHOLDS[getPriceTier(inputPrice)].color;
}

export function formatContextWindow(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return tokens.toString();
}

export function formatPrice(price: number): string {
  if (price === 0) return "Free";
  if (price < 0.01) return `$${price.toFixed(4)}`;
  if (price < 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(0)}`;
}
