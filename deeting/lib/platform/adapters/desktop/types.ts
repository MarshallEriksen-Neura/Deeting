export type LocalProviderPreset = {
  slug: string;
  name: string;
  provider: string;
  base_url: string;
  icon?: string | null;
  theme_color?: string | null;
  category?: string | null;
  url_template?: string | null;
  auth_type?: string | null;
  auth_config?: Record<string, unknown> | null;
  protocol_schema_version?: string | null;
  protocol_profiles?: Record<string, unknown> | null;
  version?: number;
  is_active: boolean;
};

export type LocalProviderInstance = {
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

export type LocalProviderModel = {
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
