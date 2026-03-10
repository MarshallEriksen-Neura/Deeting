import { z } from "zod"

import { isTauriRuntime } from "@/lib/api/desktop-config"

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export const DesktopObjectStorageProviderSchema = z.enum([
  "cloudflare_r2_s3",
  "aliyun_oss",
])

export const DesktopObjectStorageConfigSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  provider: DesktopObjectStorageProviderSchema,
  bucket: z.string(),
  region: z.string().nullable().optional(),
  endpoint: z.string().url(),
  public_base_url: z.string().url().nullable().optional(),
  path_prefix: z.string().nullable().optional(),
  is_path_style: z.boolean(),
  access_key_id: z.string(),
  has_secret: z.boolean(),
  is_enabled: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const DesktopObjectStorageConfigUpdateSchema = z.object({
  provider: DesktopObjectStorageProviderSchema,
  bucket: z.string().min(1),
  region: z.string().nullable().optional(),
  endpoint: z.string().url(),
  public_base_url: z.string().url().nullable().optional(),
  path_prefix: z.string().nullable().optional(),
  is_path_style: z.boolean().optional(),
  access_key_id: z.string().min(1),
  secret_access_key: z.string().optional(),
  is_enabled: z.boolean().optional(),
})

export const DesktopObjectStorageUploadTicketSchema = z.object({
  provider: DesktopObjectStorageProviderSchema,
  object_key: z.string(),
  upload_url: z.string().url(),
  method: z.string(),
  headers: z.record(z.string(), z.string()),
  asset_url: z.string().url().nullable().optional(),
  expires_at: z.string(),
})

export const DesktopObjectStorageReadTicketSchema = z.object({
  provider: DesktopObjectStorageProviderSchema,
  object_key: z.string(),
  asset_url: z.string().url(),
  expires_at: z.string(),
})

export type DesktopObjectStorageProvider = z.infer<typeof DesktopObjectStorageProviderSchema>
export type DesktopObjectStorageConfig = z.infer<typeof DesktopObjectStorageConfigSchema>
export type DesktopObjectStorageConfigUpdate = z.infer<
  typeof DesktopObjectStorageConfigUpdateSchema
>
export type DesktopObjectStorageUploadTicket = z.infer<
  typeof DesktopObjectStorageUploadTicketSchema
>
export type DesktopObjectStorageReadTicket = z.infer<
  typeof DesktopObjectStorageReadTicketSchema
>

export async function fetchDesktopObjectStorageConfig(): Promise<DesktopObjectStorageConfig | null> {
  if (!isTauriRuntime()) return null
  const data = await invokeTauri<DesktopObjectStorageConfig | null>(
    "get_local_desktop_object_storage_config"
  )
  if (!data) return null
  return DesktopObjectStorageConfigSchema.parse(data)
}

export async function updateDesktopObjectStorageConfig(
  payload: DesktopObjectStorageConfigUpdate
): Promise<DesktopObjectStorageConfig> {
  if (!isTauriRuntime()) {
    throw new Error("desktop object storage config is only available in Tauri runtime")
  }
  const normalizedPayload = DesktopObjectStorageConfigUpdateSchema.parse(payload)
  const data = await invokeTauri<DesktopObjectStorageConfig>(
    "update_local_desktop_object_storage_config",
    {
      payload: normalizedPayload,
    }
  )
  return DesktopObjectStorageConfigSchema.parse(data)
}

export async function clearDesktopObjectStorageConfig(): Promise<boolean> {
  if (!isTauriRuntime()) return false
  return invokeTauri<boolean>("clear_local_desktop_object_storage_config")
}

export async function deleteDesktopObjectStorageObject(
  objectKey: string
): Promise<boolean> {
  if (!isTauriRuntime()) return false
  return invokeTauri<boolean>("delete_local_desktop_object_storage_object", {
    object_key: objectKey,
  })
}

export async function prepareDesktopObjectStorageUpload(payload: {
  object_key: string
  content_type?: string | null
  expires_seconds?: number
}): Promise<DesktopObjectStorageUploadTicket> {
  if (!isTauriRuntime()) {
    throw new Error("desktop object storage upload is only available in Tauri runtime")
  }
  const data = await invokeTauri<DesktopObjectStorageUploadTicket>(
    "prepare_local_desktop_object_storage_upload",
    {
      payload: {
        object_key: payload.object_key,
        content_type: payload.content_type ?? null,
        expires_seconds: payload.expires_seconds,
      },
    }
  )
  return DesktopObjectStorageUploadTicketSchema.parse(data)
}

export async function prepareDesktopObjectStorageRead(payload: {
  object_key: string
  expires_seconds?: number
}): Promise<DesktopObjectStorageReadTicket> {
  if (!isTauriRuntime()) {
    throw new Error("desktop object storage read is only available in Tauri runtime")
  }
  const data = await invokeTauri<DesktopObjectStorageReadTicket>(
    "prepare_local_desktop_object_storage_read",
    {
      payload: {
        object_key: payload.object_key,
        expires_seconds: payload.expires_seconds,
      },
    }
  )
  return DesktopObjectStorageReadTicketSchema.parse(data)
}
