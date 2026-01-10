/**
 * Model Management Types
 *
 * Core data structures for the Model Inventory / Registry page.
 * Designed for the "Cyber-Relief" (赛博浮雕) aesthetic.
 */

// Model capability types
export type ModelCapability = 'chat' | 'vision' | 'audio' | 'embedding' | 'code' | 'reasoning'

// Provider instance status
export type ProviderStatus = 'online' | 'offline' | 'degraded' | 'syncing'

// Price tier for visual encoding
export type PriceTier = 'free' | 'cheap' | 'moderate' | 'expensive' | 'premium'

/**
 * ProviderModel - Represents a single model from a provider
 * The core data structure for the Model Matrix
 */
export interface ProviderModel {
  /** Unique model ID from provider: e.g., "gpt-4-1106-preview" */
  id: string
  /** OpenAI-compatible object type */
  object: 'model'
  /** User-defined display alias */
  display_name?: string
  /** Model capabilities (chat, vision, audio, embedding, etc.) */
  capabilities: ModelCapability[]
  /** Context window size in tokens: e.g., 128000 */
  context_window: number
  /** Pricing per 1M tokens (USD) */
  pricing: {
    input: number
    output: number
  }
  /** Whether model is active in the gateway */
  is_active: boolean
  /** Last updated timestamp */
  updated_at: string
  /** Created at timestamp */
  created_at?: string
  /** Model family/series: e.g., "gpt-4", "claude-3" */
  family?: string
  /** Model version identifier */
  version?: string
  /** Maximum output tokens */
  max_output_tokens?: number
  /** Whether model supports function calling */
  supports_functions?: boolean
  /** Whether model supports JSON mode */
  supports_json_mode?: boolean
  /** Deprecation date if applicable */
  deprecated_at?: string
}

/**
 * ProviderInstance - Represents a connected provider (e.g., "My OpenAI Key")
 * Used for the Instance Dashboard (Layer A)
 */
export interface ProviderInstance {
  /** Unique instance ID */
  id: string
  /** User-defined name: e.g., "Production GPT-4" */
  name: string
  /** Provider type: e.g., "openai", "anthropic", "ollama" */
  provider: string
  /** Provider display name */
  provider_display_name: string
  /** API base URL */
  base_url: string
  /** Current status */
  status: ProviderStatus
  /** Last ping latency in ms */
  latency: number
  /** Last sync timestamp */
  last_synced_at?: string
  /** Number of models available */
  model_count: number
  /** Brand theme color */
  theme_color?: string
  /** Is this instance enabled */
  is_enabled: boolean
  /** Health check interval in seconds */
  health_check_interval?: number
}

/**
 * FilterState - Current filter state for the Filter Lens
 */
export interface ModelFilterState {
  /** Search query */
  search: string
  /** Selected capabilities (multi-select) */
  capabilities: ModelCapability[]
  /** Minimum context window filter */
  min_context_window: number | null
  /** Show only active models */
  active_only: boolean
  /** Price tier filter */
  price_tier: PriceTier | null
}

/**
 * SyncState - State for model synchronization
 */
export interface SyncState {
  /** Is currently syncing */
  is_syncing: boolean
  /** Sync progress (0-100) */
  progress: number
  /** Last sync timestamp */
  last_sync: string | null
  /** Sync error if any */
  error: string | null
}

/**
 * TestMessage - Chat message for the Mini-Playground
 */
export interface TestMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  /** Tokens used in this message */
  tokens?: number
  /** Response latency in ms */
  latency?: number
}

/**
 * TestSession - A testing session in the debug drawer
 */
export interface TestSession {
  model_id: string
  instance_id: string
  messages: TestMessage[]
  is_loading: boolean
  error?: string
}

// Capability metadata for display
export const CAPABILITY_META: Record<ModelCapability, {
  icon: string
  label: string
  description: string
}> = {
  chat: {
    icon: '💬',
    label: 'Chat',
    description: 'Conversational AI capabilities'
  },
  vision: {
    icon: '👁️',
    label: 'Vision',
    description: 'Image understanding and analysis'
  },
  audio: {
    icon: '🗣️',
    label: 'Audio',
    description: 'Speech recognition and synthesis'
  },
  embedding: {
    icon: '🔢',
    label: 'Embedding',
    description: 'Text embedding generation'
  },
  code: {
    icon: '💻',
    label: 'Code',
    description: 'Code generation and understanding'
  },
  reasoning: {
    icon: '🧠',
    label: 'Reasoning',
    description: 'Advanced reasoning capabilities'
  }
}

// Context window presets for filtering
export const CONTEXT_WINDOW_PRESETS = [
  { label: 'All', value: null },
  { label: '> 8k', value: 8000 },
  { label: '> 32k', value: 32000 },
  { label: '> 128k', value: 128000 },
  { label: '> 200k', value: 200000 },
] as const

// Price tier thresholds (per 1M input tokens)
export const PRICE_TIER_THRESHOLDS: Record<PriceTier, { max: number; color: string }> = {
  free: { max: 0, color: 'text-emerald-400' },
  cheap: { max: 1, color: 'text-emerald-500' },
  moderate: { max: 5, color: 'text-yellow-500' },
  expensive: { max: 15, color: 'text-orange-500' },
  premium: { max: Infinity, color: 'text-red-500' },
}

/**
 * Get price tier from input price
 */
export function getPriceTier(inputPrice: number): PriceTier {
  if (inputPrice === 0) return 'free'
  if (inputPrice <= 1) return 'cheap'
  if (inputPrice <= 5) return 'moderate'
  if (inputPrice <= 15) return 'expensive'
  return 'premium'
}

/**
 * Get color class for price tier
 */
export function getPriceColor(inputPrice: number): string {
  const tier = getPriceTier(inputPrice)
  return PRICE_TIER_THRESHOLDS[tier].color
}

/**
 * Format context window for display
 */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}k`
  }
  return tokens.toString()
}

/**
 * Format price for display
 */
export function formatPrice(price: number): string {
  if (price === 0) return 'Free'
  if (price < 0.01) return `$${price.toFixed(4)}`
  if (price < 1) return `$${price.toFixed(2)}`
  return `$${price.toFixed(0)}`
}
