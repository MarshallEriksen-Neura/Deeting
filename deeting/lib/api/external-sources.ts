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

export const ExternalExperienceCandidateSchema = z.object({
  id: z.string(),
  source_id: z.string(),
  raw_record_id: z.string(),
  candidate_kind: z.string(),
  title: z.string(),
  summary: z.string(),
  canonical_payload_json: z.string(),
  provenance_json: z.string(),
  confidence: z.number(),
  validation_status: z.string(),
  review_status: z.string(),
  rejected_reason: z.string().nullable().optional(),
  accepted_target: z.string().nullable().optional(),
  accepted_ref: z.string().nullable().optional(),
  adoption_status: z.string(),
  adopted_memory_id: z.string().nullable().optional(),
  adoption_error: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  accepted_at: z.string().nullable().optional(),
  adopted_at: z.string().nullable().optional(),
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
  filename: z.string().optional(),
  content_type: z.string().optional(),
  source_label: z.string().optional(),
  import_mode: z.string().optional(),
})

export const ExternalSourceTranslationRunResultSchema = z.object({
  translated_count: z.number().int(),
  failed_count: z.number().int(),
})

export const AcceptExternalExperienceCandidateResultSchema = z.object({
  candidate: ExternalExperienceCandidateSchema,
  accepted_ref: z.string(),
})

export const AdoptExternalExperienceCandidateResultSchema = z.object({
  candidate: ExternalExperienceCandidateSchema,
  memory_id: z.string(),
  memory_action: z.string(),
})

export type ExternalSourceConnectorType = z.infer<
  typeof ExternalSourceConnectorTypeSchema
>
export type ExternalSourceAuthMode = z.infer<typeof ExternalSourceAuthModeSchema>
export type ExternalSourceSyncMode = z.infer<typeof ExternalSourceSyncModeSchema>
export type ExternalSourceStatus = z.infer<typeof ExternalSourceStatusSchema>
export type ExternalSourceRecord = z.infer<typeof ExternalSourceRecordSchema>
export type ExternalRawRecord = z.infer<typeof ExternalRawRecordSchema>
export type ExternalExperienceCandidate = z.infer<
  typeof ExternalExperienceCandidateSchema
>
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
export type ExternalSourceTranslationRunResult = z.infer<
  typeof ExternalSourceTranslationRunResultSchema
>
export type AcceptExternalExperienceCandidateResult = z.infer<
  typeof AcceptExternalExperienceCandidateResultSchema
>
export type AdoptExternalExperienceCandidateResult = z.infer<
  typeof AdoptExternalExperienceCandidateResultSchema
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

export async function translateExternalRecordsOnce(
  limit = 20
): Promise<ExternalSourceTranslationRunResult> {
  if (!isTauriRuntime()) return { translated_count: 0, failed_count: 0 }
  const data = await invokeTauri<ExternalSourceTranslationRunResult>(
    "translate_local_external_records_once",
    { limit }
  )
  return ExternalSourceTranslationRunResultSchema.parse(data)
}

export async function listExternalExperienceCandidates(payload?: {
  sourceId?: string
  rawRecordId?: string
  limit?: number
}): Promise<ExternalExperienceCandidate[]> {
  if (!isTauriRuntime()) return []
  const requestPayload = {
    source_id: payload?.sourceId,
    raw_record_id: payload?.rawRecordId,
    limit: payload?.limit,
  }
  const data = await invokeTauri<ExternalExperienceCandidate[]>(
    "list_local_external_experience_candidates",
    { payload: requestPayload }
  )
  return z.array(ExternalExperienceCandidateSchema).parse(data)
}

export async function reviewExternalExperienceCandidate(
  candidateId: string,
  reviewStatus: "pending" | "approved" | "rejected",
  rejectedReason?: string
): Promise<ExternalExperienceCandidate> {
  if (!isTauriRuntime()) {
    throw new Error("external sources are only available in Tauri runtime")
  }
  const data = await invokeTauri<ExternalExperienceCandidate>(
    "review_local_external_experience_candidate",
    {
      candidateId,
      candidate_id: candidateId,
      payload: {
        review_status: reviewStatus,
        rejected_reason: rejectedReason,
      },
    }
  )
  return ExternalExperienceCandidateSchema.parse(data)
}

export async function acceptExternalExperienceCandidate(
  candidateId: string,
  target = "llm_wiki"
): Promise<AcceptExternalExperienceCandidateResult> {
  if (!isTauriRuntime()) {
    throw new Error("external sources are only available in Tauri runtime")
  }
  const data = await invokeTauri<AcceptExternalExperienceCandidateResult>(
    "accept_local_external_experience_candidate",
    {
      candidateId,
      candidate_id: candidateId,
      payload: { target },
    }
  )
  return AcceptExternalExperienceCandidateResultSchema.parse(data)
}

export async function adoptExternalExperienceCandidate(
  candidateId: string,
  target = "memory"
): Promise<AdoptExternalExperienceCandidateResult> {
  if (!isTauriRuntime()) {
    throw new Error("external sources are only available in Tauri runtime")
  }
  const data = await invokeTauri<AdoptExternalExperienceCandidateResult>(
    "adopt_local_external_experience_candidate",
    {
      candidateId,
      candidate_id: candidateId,
      payload: { target },
    }
  )
  return AdoptExternalExperienceCandidateResultSchema.parse(data)
}
