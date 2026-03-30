import { z } from "zod"

import { isTauriRuntime } from "./desktop-config"

const LocalMaintenanceActionRequestSchema = z.object({
  kind: z.string(),
  limit: z.number().optional(),
  reinstallMissing: z.boolean().optional(),
})

const LocalMaintenanceLogItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
  message: z.string(),
  details: z.unknown().nullish(),
  created_at: z.string(),
})

const LocalMaintenanceLogListResponseSchema = z.object({
  total: z.number(),
  skip: z.number(),
  limit: z.number(),
  items: z.array(LocalMaintenanceLogItemSchema),
})

const LocalCapabilityRegistryDiagnosticsBucketSchema = z.object({
  key: z.string(),
  count: z.number(),
})

const LocalCapabilityRegistryDiagnosticsItemSchema = z.object({
  capability_id: z.string(),
  source_kind: z.string(),
  asset_kind: z.string(),
  package_id: z.string(),
  package_version: z.string().nullable().optional(),
  title: z.string(),
  tool_name: z.string().nullable().optional(),
  callable_name: z.string().nullable().optional(),
  execution_surface: z.string(),
  activation_state: z.string(),
  runtime_state: z.string(),
  search_index_state: z.string(),
  generation: z.number(),
  is_direct_callable: z.boolean(),
  updated_at: z.string(),
})

const LocalCapabilityRegistryParityItemSchema = z.object({
  key: z.string(),
  asset_id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  source_type: z.string(),
  asset_type: z.string(),
  package_id: z.string().nullable().optional(),
})

const LocalCapabilityRegistryCacheStatusSchema = z.object({
  current_epoch: z.number(),
  cache_present: z.boolean(),
  cache_ttl_ms: z.number(),
  cache_age_ms: z.number().nullable().optional(),
  last_build_epoch: z.number().nullable().optional(),
  last_invalidation_epoch: z.number().nullable().optional(),
  last_invalidation_reason: z.string().nullable().optional(),
  cache_hit_count: z.number(),
  cache_miss_count: z.number(),
  build_count: z.number(),
})

const LocalCapabilityRegistryDiagnosticsResponseSchema = z.object({
  read_path_enabled: z.boolean(),
  read_path_mode: z.string(),
  legacy_control_plane_reads_enabled: z.boolean(),
  current_generation: z.number(),
  total: z.number(),
  direct_callable_count: z.number(),
  source_kind_counts: z.array(LocalCapabilityRegistryDiagnosticsBucketSchema),
  memory_source_type_counts: z.array(LocalCapabilityRegistryDiagnosticsBucketSchema),
  asset_kind_counts: z.array(LocalCapabilityRegistryDiagnosticsBucketSchema),
  activation_state_counts: z.array(LocalCapabilityRegistryDiagnosticsBucketSchema),
  runtime_state_counts: z.array(LocalCapabilityRegistryDiagnosticsBucketSchema),
  search_index_state_counts: z.array(LocalCapabilityRegistryDiagnosticsBucketSchema),
  legacy_only_asset_count: z.number(),
  registry_first_only_asset_count: z.number(),
  migration_gaps: z.array(z.string()),
  legacy_only_assets: z.array(LocalCapabilityRegistryParityItemSchema),
  registry_first_only_assets: z.array(LocalCapabilityRegistryParityItemSchema),
  cache_status: LocalCapabilityRegistryCacheStatusSchema.nullable().optional(),
  items: z.array(LocalCapabilityRegistryDiagnosticsItemSchema),
})

export type LocalMaintenanceActionRequest = z.infer<typeof LocalMaintenanceActionRequestSchema>
export type LocalMaintenanceLogItem = z.infer<typeof LocalMaintenanceLogItemSchema>
export type LocalMaintenanceLogListResponse = z.infer<typeof LocalMaintenanceLogListResponseSchema>
export type LocalCapabilityRegistryDiagnosticsResponse = z.infer<
  typeof LocalCapabilityRegistryDiagnosticsResponseSchema
>
export type LocalCapabilityRegistryParityItem = z.infer<
  typeof LocalCapabilityRegistryParityItemSchema
>

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export async function runLocalMaintenanceAction(
  request: LocalMaintenanceActionRequest
): Promise<LocalMaintenanceLogItem | null> {
  if (!isTauriRuntime()) {
    return null
  }

  const normalizedRequest = LocalMaintenanceActionRequestSchema.parse(request)
  const data = await invokeTauri<LocalMaintenanceLogItem>("run_local_maintenance_action", {
    request: {
      kind: normalizedRequest.kind,
      limit: normalizedRequest.limit ?? 500,
      reinstallMissing: normalizedRequest.reinstallMissing ?? false,
    },
  })
  return LocalMaintenanceLogItemSchema.parse(data)
}

export async function listLocalMaintenanceLogs(options?: {
  limit?: number
  skip?: number
  kind?: string
  status?: string
}): Promise<LocalMaintenanceLogListResponse | null> {
  if (!isTauriRuntime()) {
    return null
  }

  const data = await invokeTauri<LocalMaintenanceLogListResponse>("list_local_maintenance_logs", {
    query: {
      limit: options?.limit ?? 10,
      skip: options?.skip ?? 0,
      kind: options?.kind,
      status: options?.status,
    },
  })
  return LocalMaintenanceLogListResponseSchema.parse(data)
}

export async function getLocalCapabilityRegistryDiagnostics(): Promise<LocalCapabilityRegistryDiagnosticsResponse | null> {
  if (!isTauriRuntime()) {
    return null
  }

  const data = await invokeTauri<LocalCapabilityRegistryDiagnosticsResponse>(
    "get_local_capability_registry_diagnostics"
  )
  return LocalCapabilityRegistryDiagnosticsResponseSchema.parse(data)
}
