import { z } from "zod"

async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export const LocalAssetSchema = z.object({
  asset_id: z.string(),
  asset_kind: z.string(),
  title: z.string(),
  summary: z.string().nullish(),
  origin_session_id: z.string(),
  origin_turn_index: z.number(),
  source_block_id: z.string().nullish(),
  source_view_type: z.string(),
  render_hint: z.string().nullish(),
  template_id: z.string().nullish(),
  template_version: z.string().nullish(),
  html_entry: z.string().nullish(),
  data_mode: z.string().nullish(),
  match_hints_json: z.string().nullish(),
  props_hint_json: z.string().nullish(),
  output_example_json: z.string().nullish(),
  latest_snapshot_html: z.string().nullish(),
  latest_render_data_json: z.string().nullish(),
  refresh_spec_json: z.string().nullish(),
  status: z.string(),
  is_pinned: z.boolean(),
  is_archived: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  last_refreshed_at: z.string().nullish(),
  last_opened_at: z.string().nullish(),
})

export type LocalAsset = z.infer<typeof LocalAssetSchema>

export interface SaveLocalAssetRequest {
  assetId: string
  title: string
  html: string
  summary?: string
  assetKind?: string
  sourceViewType?: string
  renderHint?: string
  templateVersion?: string
  originSessionId?: string
  originTurnIndex?: number
  sourceBlockId?: string
  dataMode?: "ai_data" | "self_fetch"
  matchHints?: string[]
  propsHint?: string[]
  outputExample?: unknown
}

export async function listLocalAssets(options?: {
  limit?: number
  pinnedOnly?: boolean
  includeArchived?: boolean
  assetId?: string
}): Promise<LocalAsset[]> {
  const data = await invokeTauri<unknown>("list_local_assets", {
    request: {
      limit: options?.limit ?? 50,
      pinned_only: options?.pinnedOnly ?? false,
      include_archived: options?.includeArchived ?? false,
      asset_id: options?.assetId,
    },
  })
  return z.array(LocalAssetSchema).parse(data)
}

export async function updateLocalAsset(
  assetId: string,
  request: {
    isPinned?: boolean
    isArchived?: boolean
    markOpened?: boolean
  }
): Promise<LocalAsset> {
  const data = await invokeTauri<unknown>("update_local_asset", {
    assetId,
    request: {
      is_pinned: request.isPinned,
      is_archived: request.isArchived,
      mark_opened: request.markOpened,
    },
  })
  return LocalAssetSchema.parse(data)
}

export async function saveLocalAsset(request: SaveLocalAssetRequest): Promise<LocalAsset> {
  const data = await invokeTauri<unknown>("save_local_asset", {
    request: {
      asset_id: request.assetId,
      title: request.title,
      html: request.html,
      summary: request.summary,
      asset_kind: request.assetKind,
      source_view_type: request.sourceViewType,
      render_hint: request.renderHint,
      template_version: request.templateVersion,
      origin_session_id: request.originSessionId,
      origin_turn_index: request.originTurnIndex,
      source_block_id: request.sourceBlockId,
      data_mode: request.dataMode,
      match_hints: request.matchHints,
      props_hint: request.propsHint,
      output_example: request.outputExample,
    },
  })
  return LocalAssetSchema.parse(data)
}
