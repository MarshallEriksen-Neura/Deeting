import { request, apiClient } from "@/lib/http"
import type {
  KnowledgeFile,
  KnowledgeFolder,
  KnowledgeStats,
  KnowledgeChunk,
  KnowledgeSortField,
  SortDirection,
} from "@/types/knowledge"

const BASE = "/api/v1/documents"

/* -------------------------------------------------------------------------- */
/*  API response types (snake_case from backend)                              */
/* -------------------------------------------------------------------------- */

interface ApiFile {
  id: string
  name: string
  type: string
  size: number
  status: string
  chunks: number | null
  error_message: string | null
  folder_id: string | null
  created_at: string
  updated_at: string
}

interface ApiFolder {
  id: string
  name: string
  parent_id: string | null
  file_count: number
  created_at: string
  updated_at: string
}

interface ApiChunk {
  id: string
  file_id: string
  index: number
  content: string
  token_count: number
}

interface ApiStats {
  used_bytes: number
  total_bytes: number
  total_vectors: number
  total_files: number
  total_folders: number
}

interface ApiBreadcrumbItem {
  id: string | null
  name: string
}

interface ApiTreeResponse {
  folders: ApiFolder[]
  files: ApiFile[]
  breadcrumb: ApiBreadcrumbItem[]
}

interface ApiChunkListResponse {
  items: ApiChunk[]
  total: number
  offset: number
  limit: number
}

/* -------------------------------------------------------------------------- */
/*  Mappers (snake_case -> camelCase)                                         */
/* -------------------------------------------------------------------------- */

function mapFile(f: ApiFile): KnowledgeFile {
  return {
    id: f.id,
    name: f.name,
    type: f.type as KnowledgeFile["type"],
    size: f.size,
    status: f.status as KnowledgeFile["status"],
    chunks: f.chunks,
    errorMessage: f.error_message ?? undefined,
    folderId: f.folder_id,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  }
}

function mapFolder(f: ApiFolder): KnowledgeFolder {
  return {
    id: f.id,
    name: f.name,
    parentId: f.parent_id,
    fileCount: f.file_count,
    createdAt: f.created_at,
  }
}

function mapChunk(c: ApiChunk): KnowledgeChunk {
  return {
    id: c.id,
    fileId: c.file_id,
    index: c.index,
    content: c.content,
    tokenCount: c.token_count,
  }
}

function mapStats(s: ApiStats): KnowledgeStats {
  return {
    usedBytes: s.used_bytes,
    totalBytes: s.total_bytes,
    totalVectors: s.total_vectors,
    totalFiles: s.total_files,
    totalFolders: s.total_folders,
  }
}

const SORT_FIELD_MAP: Record<KnowledgeSortField, string> = {
  name: "name",
  size: "size",
  status: "status",
  chunks: "chunks",
  createdAt: "created_at",
}

/* -------------------------------------------------------------------------- */
/*  Exported types                                                            */
/* -------------------------------------------------------------------------- */

export interface KnowledgeTreeResult {
  folders: KnowledgeFolder[]
  files: KnowledgeFile[]
  breadcrumb: { id: string | null; name: string }[]
}

/* -------------------------------------------------------------------------- */
/*  Tree & Stats                                                              */
/* -------------------------------------------------------------------------- */

export async function fetchKnowledgeTree(params: {
  parentId?: string | null
  q?: string
  sortField?: KnowledgeSortField
  sortDirection?: SortDirection
}): Promise<KnowledgeTreeResult> {
  const queryParams: Record<string, string> = {}
  if (params.parentId) queryParams.parent_id = params.parentId
  if (params.q) queryParams.q = params.q
  if (params.sortField) queryParams.sort_field = SORT_FIELD_MAP[params.sortField]
  if (params.sortDirection) queryParams.sort_direction = params.sortDirection

  const data = await request<ApiTreeResponse>({
    url: `${BASE}/tree`,
    params: queryParams,
  })

  return {
    folders: data.folders.map(mapFolder),
    files: data.files.map(mapFile),
    breadcrumb: data.breadcrumb,
  }
}

export async function fetchKnowledgeStats(): Promise<KnowledgeStats> {
  const data = await request<ApiStats>({ url: `${BASE}/stats` })
  return mapStats(data)
}

/* -------------------------------------------------------------------------- */
/*  Folder CRUD                                                               */
/* -------------------------------------------------------------------------- */

export async function createFolder(params: {
  name: string
  parentId?: string | null
}): Promise<KnowledgeFolder> {
  const data = await request<ApiFolder>({
    url: `${BASE}/folders`,
    method: "POST",
    data: { name: params.name, parent_id: params.parentId ?? null },
  })
  return mapFolder(data)
}

export async function updateFolder(
  folderId: string,
  params: { name: string }
): Promise<KnowledgeFolder> {
  const data = await request<ApiFolder>({
    url: `${BASE}/folders/${folderId}`,
    method: "PATCH",
    data: { name: params.name },
  })
  return mapFolder(data)
}

export async function deleteFolder(
  folderId: string,
  recursive = false
): Promise<void> {
  await request({
    url: `${BASE}/folders/${folderId}`,
    method: "DELETE",
    params: { recursive },
  })
}

/* -------------------------------------------------------------------------- */
/*  File Upload                                                               */
/* -------------------------------------------------------------------------- */

export async function uploadFile(
  file: File,
  folderId?: string | null,
  onProgress?: (percent: number) => void
): Promise<KnowledgeFile> {
  const formData = new FormData()
  formData.append("file", file)
  if (folderId) formData.append("folder_id", folderId)

  const { data } = await apiClient.post<ApiFile>(`${BASE}/files`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 120_000,
    onUploadProgress: (e) => {
      if (e.total && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    },
  })
  return mapFile(data)
}

/* -------------------------------------------------------------------------- */
/*  File CRUD                                                                 */
/* -------------------------------------------------------------------------- */

export async function getFile(fileId: string): Promise<KnowledgeFile> {
  const data = await request<ApiFile>({ url: `${BASE}/files/${fileId}` })
  return mapFile(data)
}

export async function updateFile(
  fileId: string,
  params: { name?: string; folderId?: string | null }
): Promise<KnowledgeFile> {
  const body: Record<string, unknown> = {}
  if (params.name !== undefined) body.name = params.name
  if (params.folderId !== undefined) body.folder_id = params.folderId

  const data = await request<ApiFile>({
    url: `${BASE}/files/${fileId}`,
    method: "PATCH",
    data: body,
  })
  return mapFile(data)
}

export async function deleteFile(fileId: string): Promise<void> {
  await request({
    url: `${BASE}/files/${fileId}`,
    method: "DELETE",
  })
}

export async function copyFile(
  fileId: string,
  params?: { name?: string; folderId?: string | null }
): Promise<KnowledgeFile> {
  const data = await request<ApiFile>({
    url: `${BASE}/files/${fileId}/copy`,
    method: "POST",
    data: params
      ? { name: params.name, folder_id: params.folderId }
      : undefined,
  })
  return mapFile(data)
}

export async function retryFile(fileId: string): Promise<KnowledgeFile> {
  const data = await request<ApiFile>({
    url: `${BASE}/files/${fileId}/retry`,
    method: "POST",
  })
  return mapFile(data)
}

/* -------------------------------------------------------------------------- */
/*  File Chunks                                                               */
/* -------------------------------------------------------------------------- */

export async function fetchFileChunks(
  fileId: string,
  params?: { offset?: number; limit?: number }
): Promise<{ items: KnowledgeChunk[]; total: number }> {
  const data = await request<ApiChunkListResponse>({
    url: `${BASE}/files/${fileId}/chunks`,
    params,
  })
  return {
    items: data.items.map(mapChunk),
    total: data.total,
  }
}

/* -------------------------------------------------------------------------- */
/*  Download & Share                                                          */
/* -------------------------------------------------------------------------- */

export async function getFileDownloadUrl(fileId: string): Promise<string> {
  const data = await request<{ download_url: string }>({
    url: `${BASE}/files/${fileId}/download-url`,
  })
  return data.download_url
}

export async function shareFile(
  fileId: string,
  expiresSeconds?: number
): Promise<string> {
  const data = await request<{ share_url: string }>({
    url: `${BASE}/files/${fileId}/share`,
    method: "POST",
    data: expiresSeconds ? { expires_seconds: expiresSeconds } : undefined,
  })
  return data.share_url
}

/* -------------------------------------------------------------------------- */
/*  Batch Operations                                                          */
/* -------------------------------------------------------------------------- */

export async function batchDeleteFiles(
  fileIds: string[]
): Promise<{ deletedCount: number }> {
  const data = await request<{ deleted_count: number }>({
    url: `${BASE}/files/batch/delete`,
    method: "POST",
    data: { file_ids: fileIds },
  })
  return { deletedCount: data.deleted_count }
}

export async function batchMoveFiles(
  fileIds: string[],
  folderId: string | null
): Promise<KnowledgeFile[]> {
  const data = await request<{ files: ApiFile[] }>({
    url: `${BASE}/files/batch/move`,
    method: "POST",
    data: { file_ids: fileIds, folder_id: folderId },
  })
  return data.files.map(mapFile)
}

export async function batchCopyFiles(
  fileIds: string[],
  folderId?: string | null
): Promise<KnowledgeFile[]> {
  const data = await request<{ files: ApiFile[] }>({
    url: `${BASE}/files/batch/copy`,
    method: "POST",
    data: { file_ids: fileIds, folder_id: folderId },
  })
  return data.files.map(mapFile)
}
