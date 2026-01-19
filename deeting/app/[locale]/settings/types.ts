export interface SettingsFormValues {
  cloudModel: string
  secretaryModel: string
}

export interface ModelGroup {
  instance_id: string
  instance_name: string
  provider?: string
  models: Array<{
    id: string
    owned_by?: string
    upstream_model_id?: string
    provider_model_id?: string
  }>
}

export const EMBEDDING_MODELS = [
  "text-embedding-3-small",
  "text-embedding-3-large",
  "text-embedding-ada-002",
] as const
