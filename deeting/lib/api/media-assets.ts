import { z } from "zod"

import { request } from "@/lib/http"

const MEDIA_ASSETS_BASE = "/media/assets"

const AssetUploadInitResponseSchema = z.object({
  deduped: z.boolean(),
  object_key: z.string(),
  asset_url: z.string().nullable(),
  upload_url: z.string().nullable(),
  upload_headers: z.record(z.string()).nullable(),
  expires_in: z.number().nullable(),
})

const AssetUploadCompleteResponseSchema = z.object({
  object_key: z.string(),
  asset_url: z.string(),
})

const AssetSignedItemSchema = z.object({
  object_key: z.string(),
  asset_url: z.string(),
})

const AssetSignResponseSchema = z.object({
  assets: z.array(AssetSignedItemSchema),
})

export type AssetUploadInitRequest = {
  content_hash: string
  size_bytes: number
  content_type: string
  kind?: string
  expires_seconds?: number
}

export type AssetUploadCompleteRequest = {
  object_key: string
  content_hash: string
  size_bytes: number
  content_type: string
}

export type AssetSignRequest = {
  object_keys: string[]
  expires_seconds?: number
}

export type AssetUploadInitResponse = z.infer<typeof AssetUploadInitResponseSchema>
export type AssetUploadCompleteResponse = z.infer<typeof AssetUploadCompleteResponseSchema>
export type AssetSignResponse = z.infer<typeof AssetSignResponseSchema>

export async function initAssetUpload(
  payload: AssetUploadInitRequest
): Promise<AssetUploadInitResponse> {
  const data = await request({
    url: `${MEDIA_ASSETS_BASE}/upload/init`,
    method: "POST",
    data: payload,
  })
  return AssetUploadInitResponseSchema.parse(data)
}

export async function completeAssetUpload(
  payload: AssetUploadCompleteRequest
): Promise<AssetUploadCompleteResponse> {
  const data = await request({
    url: `${MEDIA_ASSETS_BASE}/upload/complete`,
    method: "POST",
    data: payload,
  })
  return AssetUploadCompleteResponseSchema.parse(data)
}

export async function signAssets(
  objectKeys: string[],
  expiresSeconds?: number
): Promise<AssetSignResponse> {
  const data = await request({
    url: `${MEDIA_ASSETS_BASE}/sign`,
    method: "POST",
    data: {
      object_keys: objectKeys,
      expires_seconds: expiresSeconds,
    } satisfies AssetSignRequest,
  })
  return AssetSignResponseSchema.parse(data)
}
