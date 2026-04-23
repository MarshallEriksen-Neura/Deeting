import { z } from "zod"

import { isTauriRuntime } from "@/lib/api/desktop-config"

async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export const ExternalSourceConnectorTypeSchema = z.enum([
  "manual_import",
  "evomap_public_feed",
  "evomap_kg",
])

export const ExternalSourceAuthModeSchema = z.enum(["none", "api_key"])
export const ExternalSourceSyncModeSchema = z.enum(["manual", "scheduled"])
export const ExternalSourceStatusSchema = z.enum([
  "draft",
  "ready",
  "syncing",
  "error",
  "disabled",
])

export const ExternalSourceRecordSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  connector_type: ExternalSourceConnectorTypeSchema,
  auth_mode: ExternalSourceAuthModeSchema,
  base_url: z.string().nullable().optional(),
  is_enabled: z.boolean(),
  sync_mode: ExternalSourceSyncModeSchema,
  sync_interval_minutes: z.number().int(),
  status: ExternalSourceStatusSchema,
  last_synced_at: z.string().nullable().optional(),
  last_error: z.string().nullable().optional(),
  trust_level: z.string(),
  has_credentials: z.boolean(),
  metadata_json: z.unknown(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const ExternalRawRecordSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  source_asset_id: z.string(),
  source_version: z.string().nullable().optional(),
  asset_family: z.string(),
  observed_at_unix_ms: z.number().int(),
  freshness_hint: z.number().nullable().optional(),
  content_hash: z.string(),
  raw_payload_json: z.string(),
  translation_status: z.string(),
  translated_at_unix_ms: z.number().nullable().optional(),
  translation_error: z.string().nullable().optional(),
})

export const ExternalSourceConnectionTestResultSchema = z.object({
  ok: z.boolean(),
  status: z.number().int().nullable().optional(),
  message: z.string(),
  connector_type: ExternalSourceConnectorTypeSchema,
  endpoint: z.string().nullable().optional(),
  discovered_targets: z.array(z.string()).default([]),
})

export const ExternalSourceSyncResultSchema = z.object({
  source_id: z.string(),
  connector_type: ExternalSourceConnectorTypeSchema,
  fetched_count: z.number().int(),
  stored_count: z.number().int(),
  synced_targets: z.array(z.string()).default([]),
  synced_at: z.string(),
})

export const CreateExternalSourcePayloadSchema = z.object({
  display_name: z.string().min(1),
  connector_type: ExternalSourceConnectorTypeSchema,
  base_url: z.string().url().optional(),
  api_key: z.string().optional(),
  sync_mode: ExternalSourceSyncModeSchema.optional(),
  sync_interval_minutes: z.number().int().optional(),
  is_enabled: z.boolean().optional(),
})

export const UpdateExternalSourcePayloadSchema = z.object({
  display_name: z.string().min(1).optional(),
  base_url: z.string().url().optional(),
  api_key: z.string().optional(),
  clear_api_key: z.boolean().optional(),
  sync_mode: ExternalSourceSyncModeSchema.optional(),
  sync_interval_minutes: z.number().int().optional(),
  is_enabled: z.boolean().optional(),
})

export const CreateManualExternalRecordPayloadSchema = z.object({
  asset_family: z.string().min(1),
  source_asset_id: z.string().min(1),
  source_version: z.string().optional(),
  payload_text: z.string().min(1),
  freshness_hint: z.number().optional(),
})

export type ExternalSourceConnectorType = z.infer<
  typeof ExternalSourceConnectorTypeSchema
>
export type ExternalSourceAuthMode = z.infer<typeof ExternalSourceAuthModeSchema>
export type ExternalSourceSyncMode = z.infer<typeof ExternalSourceSyncModeSchema>
export type ExternalSourceStatus = z.infer<typeof ExternalSourceStatusSchema>
export type ExternalSourceRecord = z.infer<typeof ExternalSourceRecordSchema>
export type ExternalRawRecord = z.infer<typeof ExternalRawRecordSchema>
export type ExternalSourceConnectionTestResult = z.infer<
  typeof ExternalSourceConnectionTestResultSchema
>
export type ExternalSourceSyncResult = z.infer<
  typeof ExternalSourceSyncResultSchema
>
export type CreateExternalSourcePayload = z.infer<
  typeof CreateExternalSourcePayloadSchema
>
export type UpdateExternalSourcePayload = z.infer<
  typeof UpdateExternalSourcePayloadSchema
>
export type CreateManualExternalRecordPayload = z.infer<
  typeof CreateManualExternalRecordPayloadSchema
>

export async function listExternalSources(): Promise<ExternalSourceRecord[]> {
  if (!isTauriRuntime()) return []
  const data = await invokeTauri<ExternalSourceRecord[]>("list_local_external_sources")
  return z.array(ExternalSourceRecordSchema).parse(data)
}

export async function createExternalSource(
  payload: CreateExternalSourcePayload
): Promise<ExternalSourceRecord> {
  if (!isTauriRuntime()) {
    throw new Error("external sources are only available in Tauri runtime")
  }
  const normalizedPayload = CreateExternalSourcePayloadSchema.parse(payload)
  const data = await invokeTauri<ExternalSourceRecord>(
    "create_local_external_source",
    { payload: normalizedPayload }
  )
  return ExternalSourceRecordSchema.parse(data)
}

export async function updateExternalSource(
  sourceId: string,
  payload: UpdateExternalSourcePayload
): Promise<ExternalSourceRecord> {
  if (!isTauriRuntime()) {
    throw new Error("external sources are only available in Tauri runtime")
  }
  const normalizedPayload = UpdateExternalSourcePayloadSchema.parse(payload)
  const data = await invokeTauri<ExternalSourceRecord>(
    "update_local_external_source",
    {
      sourceId,
      source_id: sourceId,
      payload: normalizedPayload,
    }
  )
  return ExternalSourceRecordSchema.parse(data)
}

export async function deleteExternalSource(sourceId: string): Promise<void> {
  if (!isTauriRuntime()) return
  await invokeTauri("delete_local_external_source", {
    sourceId,
    source_id: sourceId,
  })
}

export async function testExternalSource(
  sourceId: string
): Promise<ExternalSourceConnectionTestResult> {
  if (!isTauriRuntime()) {
    throw new Error("external sources are only available in Tauri runtime")
  }
  const data = await invokeTauri<ExternalSourceConnectionTestResult>(
    "test_local_external_source",
    {
      sourceId,
      source_id: sourceId,
    }
  )
  return ExternalSourceConnectionTestResultSchema.parse(data)
}

export async function syncExternalSource(
  sourceId: string
): Promise<ExternalSourceSyncResult> {
  if (!isTauriRuntime()) {
    throw new Error("external sources are only available in Tauri runtime")
  }
  const data = await invokeTauri<ExternalSourceSyncResult>(
    "sync_local_external_source",
    {
      sourceId,
      source_id: sourceId,
    }
  )
  return ExternalSourceSyncResultSchema.parse(data)
}

export async function listExternalSourceRecords(
  sourceId: string,
  limit = 8
): Promise<ExternalRawRecord[]> {
  if (!isTauriRuntime()) return []
  const data = await invokeTauri<ExternalRawRecord[]>(
    "list_local_external_source_records",
    {
      sourceId,
      source_id: sourceId,
      limit,
    }
  )
  return z.array(ExternalRawRecordSchema).parse(data)
}

export async function createManualExternalRecord(
  sourceId: string,
  payload: CreateManualExternalRecordPayload
): Promise<ExternalRawRecord> {
  if (!isTauriRuntime()) {
    throw new Error("external sources are only available in Tauri runtime")
  }
  const normalizedPayload = CreateManualExternalRecordPayloadSchema.parse(payload)
  const data = await invokeTauri<ExternalRawRecord>(
    "create_local_manual_external_record",
    {
      sourceId,
      source_id: sourceId,
      payload: normalizedPayload,
    }
  )
  return ExternalRawRecordSchema.parse(data)
}
