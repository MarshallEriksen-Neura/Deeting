import { z } from "zod"

import { isTauriRuntime } from "./desktop-config"

const ScanSummarySchema = z.object({
  document_count: z.number(),
  finding_count: z.number(),
  warning_count: z.number(),
  error_count: z.number(),
  skill_bundle_count: z.number(),
  index_missing_count: z.number(),
  install_missing_count: z.number(),
  security_warning_count: z.number(),
  high_risk_script_count: z.number(),
  missing_skill_doc_count: z.number(),
})

const ScanDocumentSchema = z.object({
  id: z.string(),
  path: z.string(),
  relative_path: z.string().nullish(),
  document_kind: z.string(),
  display_name: z.string(),
  bundle_id: z.string().nullish(),
  status: z.string(),
  size_bytes: z.number().nullish(),
  modified_at: z.string().nullish(),
  sha256: z.string().nullish(),
  excerpt: z.string().nullish(),
  metadata: z.unknown().nullish(),
})

const ScanFindingActionSchema = z.object({
  kind: z.string(),
  bundle_id: z.string().nullish(),
  path: z.string().nullish(),
  destructive: z.boolean().default(false),
})

const ScanFindingSchema = z.object({
  id: z.string(),
  severity: z.string(),
  code: z.string(),
  message: z.string(),
  document_path: z.string().nullish(),
  bundle_id: z.string().nullish(),
  metadata: z.unknown().nullish(),
  action: ScanFindingActionSchema.nullish(),
})

const ScanReviewActionResultSchema = z.object({
  kind: z.string(),
  status: z.string(),
  message: z.string(),
  bundle_id: z.string().nullish(),
  path: z.string().nullish(),
})

const ScanReviewBatchResultSchema = z.object({
  total: z.number(),
  applied: z.number(),
  failed: z.number(),
  skipped: z.number(),
  results: z.array(ScanReviewActionResultSchema),
})

const ScanRunSchema = z.object({
  run_id: z.string(),
  trigger: z.string(),
  target_kind: z.string(),
  target_path: z.string(),
  started_at: z.string(),
  finished_at: z.string(),
  summary: ScanSummarySchema,
  documents: z.array(ScanDocumentSchema),
  findings: z.array(ScanFindingSchema),
})

export type LocalScanRun = z.infer<typeof ScanRunSchema>
export type LocalScanFindingAction = z.infer<typeof ScanFindingActionSchema>
export type LocalScanReviewActionResult = z.infer<typeof ScanReviewActionResultSchema>
export type LocalScanReviewBatchResult = z.infer<typeof ScanReviewBatchResultSchema>

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export async function scanDirectoryReview(options?: { path?: string }): Promise<LocalScanRun | null> {
  if (!isTauriRuntime()) return null
  const data = await invokeTauri<LocalScanRun>("scan_directory", {
    path: options?.path,
  })
  return ScanRunSchema.parse(data)
}

export async function scanFileReview(path: string): Promise<LocalScanRun | null> {
  if (!isTauriRuntime()) return null
  const normalizedPath = path.trim()
  if (!normalizedPath) {
    throw new Error("path is required")
  }
  const data = await invokeTauri<LocalScanRun>("scan_file", {
    path: normalizedPath,
  })
  return ScanRunSchema.parse(data)
}

export async function runScanReviewAction(
  action: LocalScanFindingAction
): Promise<LocalScanReviewActionResult | null> {
  if (!isTauriRuntime()) return null
  const data = await invokeTauri<LocalScanReviewActionResult>("run_scan_review_action", {
    request: {
      kind: action.kind,
      bundle_id: action.bundle_id,
      path: action.path,
    },
  })
  return ScanReviewActionResultSchema.parse(data)
}

export async function runScanReviewActions(
  actions: LocalScanFindingAction[]
): Promise<LocalScanReviewBatchResult | null> {
  if (!isTauriRuntime()) return null
  const data = await invokeTauri<LocalScanReviewBatchResult>("run_scan_review_actions", {
    request: {
      actions: actions.map((action) => ({
        kind: action.kind,
        bundle_id: action.bundle_id,
        path: action.path,
      })),
    },
  })
  return ScanReviewBatchResultSchema.parse(data)
}