import { request, apiClient } from "@/lib/http"
import { handleModelConfigRequiredError } from "@/lib/model-config-required"
import type {
  KnowledgeFile,
  KnowledgeFolder,
  KnowledgeStats,
  KnowledgeChunk,
  KnowledgeSortField,
  SortDirection,
} from "@/types/knowledge"

const BASE = "/api/v1/documents"
const LOCAL_TEXT_FILE_TYPES = new Set(["txt", "md", "csv", "html", "json"])
const LOCAL_TEXT_MAX_BYTES = 2 * 1024 * 1024
const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    handleModelConfigRequiredError(error)
    throw error
  }
}

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

interface LocalKnowledgeFile {
  id: string
  name: string
  file_type: string
  size: number
  status: string
  chunks: number | null
  error_message: string | null
  folder_id: string | null
  created_at: string
  updated_at: string
}

interface LocalKnowledgeChunk {
  id: string
  file_id: string
  index: number
  content: string
  token_count: number
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

interface LocalKnowledgeTreeResponse {
  folders: ApiFolder[]
  files: LocalKnowledgeFile[]
  breadcrumb: ApiBreadcrumbItem[]
}

interface ApiChunkListResponse {
  items: ApiChunk[]
  total: number
  offset: number
  limit: number
}

interface LocalKnowledgeStatsResponse {
  used_bytes: number
  total_bytes: number
  total_vectors: number
  total_files: number
  total_folders: number
}

interface LocalKnowledgeChunkListResponse {
  items: LocalKnowledgeChunk[]
  total: number
  offset: number
  limit: number
}

/* -------------------------------------------------------------------------- */
/*  Mappers (snake_case -> camelCase)                                         */
/* -------------------------------------------------------------------------- */

function mapFile(f: ApiFile): KnowledgeFile {
  const normalizedType = normalizeFileType(f.type)
  const normalizedStatus = normalizeFileStatus(f.status)
  return {
    id: f.id,
    name: f.name,
    type: normalizedType,
    size: f.size,
    status: normalizedStatus,
    chunks: f.chunks,
    errorMessage: f.error_message ?? undefined,
    folderId: f.folder_id,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  }
}

function mapLocalFile(file: LocalKnowledgeFile): KnowledgeFile {
  return mapFile({
    id: file.id,
    name: file.name,
    type: file.file_type,
    size: file.size,
    status: file.status,
    chunks: file.chunks,
    error_message: file.error_message,
    folder_id: file.folder_id,
    created_at: file.created_at,
    updated_at: file.updated_at,
  })
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

function normalizeFileType(value: string): KnowledgeFile["type"] {
  const normalized = (value || "").trim().toLowerCase()
  switch (normalized) {
    case "pdf":
    case "txt":
    case "docx":
    case "md":
    case "csv":
    case "xlsx":
    case "html":
    case "json":
      return normalized
    default:
      return "txt"
  }
}

function normalizeFileStatus(value: string): KnowledgeFile["status"] {
  const normalized = (value || "").trim().toLowerCase()
  if (normalized === "active" || normalized === "indexed" || normalized === "success") {
    return "active"
  }
  if (normalized === "failed" || normalized === "error") {
    return "failed"
  }
  return "processing"
}

function inferFileTypeFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.trim().toLowerCase() ?? ""
  if (!ext) return "txt"
  const knownTypes = new Set(["pdf", "txt", "docx", "md", "csv", "xlsx", "html", "json"])
  if (knownTypes.has(ext)) return ext
  return ext
}

function buildLocalUnsupportedFileError(fileType: string): string {
  return `本地离线暂不支持 ${fileType.toUpperCase()} 解析，请转换为 TXT/MD/CSV/HTML/JSON 后重试`
}

async function readLocalFileText(file: File): Promise<string> {
  const maybeText = (file as File & { text?: () => Promise<string> }).text
  if (typeof maybeText === "function") {
    return maybeText.call(file)
  }

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.onerror = () => reject(reader.error ?? new Error("failed to read local file"))
    reader.readAsText(file)
  })
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
  if (isTauriRuntime()) {
    const data = await invokeTauri<LocalKnowledgeTreeResponse>("get_local_knowledge_tree", {
      query: {
        parent_id: params.parentId ?? null,
        q: params.q ?? null,
        sort_field: params.sortField ? SORT_FIELD_MAP[params.sortField] : null,
        sort_direction: params.sortDirection ?? null,
      },
    })
    const files = data.files.map((file) =>
      mapFile({
        id: file.id,
        name: file.name,
        type: file.file_type,
        size: file.size,
        status: file.status,
        chunks: file.chunks,
        error_message: file.error_message,
        folder_id: file.folder_id,
        created_at: file.created_at,
        updated_at: file.updated_at,
      })
    )
    return {
      folders: data.folders.map(mapFolder),
      files,
      breadcrumb: data.breadcrumb,
    }
  }

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
  if (isTauriRuntime()) {
    const data = await invokeTauri<LocalKnowledgeStatsResponse>("get_local_knowledge_stats")
    return mapStats(data)
  }

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
  if (isTauriRuntime()) {
    const data = await invokeTauri<ApiFolder>("create_local_knowledge_folder", {
      payload: { name: params.name, parent_id: params.parentId ?? null },
    })
    return mapFolder(data)
  }

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
  if (isTauriRuntime()) {
    const data = await invokeTauri<ApiFolder>("update_local_knowledge_folder", {
      folder_id: folderId,
      payload: { name: params.name },
    })
    return mapFolder(data)
  }

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
  if (isTauriRuntime()) {
    await invokeTauri("delete_local_knowledge_folder", {
      folder_id: folderId,
      recursive,
    })
    return
  }

  await request({
    url: `${BASE}/folders/${folderId}`,
    method: "DELETE",
    params: { recursive },
  })
}

export async function listLocalUserDocuments(params: {
  folderId?: string | null
  status?: string
  q?: string
} = {}): Promise<KnowledgeFile[]> {
  if (!isTauriRuntime()) {
    return []
  }
  const data = await invokeTauri<LocalKnowledgeFile[]>("list_local_user_documents", {
    query: {
      folder_id: params.folderId ?? null,
      status: params.status ?? null,
      q: params.q ?? null,
    },
  })
  return data.map(mapLocalFile)
}

export async function createLocalUserDocument(params: {
  filename: string
  folderId?: string | null
  mediaAssetId?: string | null
  status?: string | null
  errorMessage?: string | null
  chunkCount?: number | null
  embeddingModel?: string | null
  metaInfo?: Record<string, unknown> | null
}): Promise<KnowledgeFile> {
  if (!isTauriRuntime()) {
    throw new Error("createLocalUserDocument is only supported in Tauri runtime")
  }
  const file = await invokeTauri<LocalKnowledgeFile>("create_local_user_document", {
    payload: {
      filename: params.filename,
      folder_id: params.folderId ?? null,
      media_asset_id: params.mediaAssetId ?? null,
      status: params.status ?? null,
      error_message: params.errorMessage ?? null,
      chunk_count: params.chunkCount ?? null,
      embedding_model: params.embeddingModel ?? null,
      meta_info: params.metaInfo ?? null,
    },
  })
  return mapLocalFile(file)
}

/* -------------------------------------------------------------------------- */
/*  File Upload                                                               */
/* -------------------------------------------------------------------------- */

export async function uploadFile(
  file: File,
  folderId?: string | null,
  onProgress?: (percent: number) => void
): Promise<KnowledgeFile> {
  if (isTauriRuntime()) {
    const fileType = inferFileTypeFromFilename(file.name)
    const baseMeta = {
      file_type: fileType,
      size: file.size,
      source: "desktop-local-upload",
    }
    if (!LOCAL_TEXT_FILE_TYPES.has(fileType)) {
      await createLocalUserDocument({
        filename: file.name,
        folderId,
        status: "failed",
        errorMessage: buildLocalUnsupportedFileError(fileType),
        metaInfo: baseMeta,
      })
      throw new Error(buildLocalUnsupportedFileError(fileType))
    }
    if (file.size > LOCAL_TEXT_MAX_BYTES) {
      const errorMessage = `本地离线文本解析大小上限为 ${Math.floor(
        LOCAL_TEXT_MAX_BYTES / 1024 / 1024
      )}MB`
      await createLocalUserDocument({
        filename: file.name,
        folderId,
        status: "failed",
        errorMessage,
        metaInfo: baseMeta,
      })
      throw new Error(errorMessage)
    }

    onProgress?.(20)
    const rawText = await readLocalFileText(file)
    onProgress?.(80)
    const created = await createLocalUserDocument({
      filename: file.name,
      folderId,
      status: "processing",
      metaInfo: {
        ...baseMeta,
        raw_text: rawText,
      },
    })
    onProgress?.(100)
    return created
  }

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
  if (isTauriRuntime()) {
    const file = await invokeTauri<LocalKnowledgeFile>("get_local_user_document", {
      file_id: fileId,
    })
    return mapLocalFile(file)
  }

  const data = await request<ApiFile>({ url: `${BASE}/files/${fileId}` })
  return mapFile(data)
}

export async function updateFile(
  fileId: string,
  params: { name?: string; folderId?: string | null }
): Promise<KnowledgeFile> {
  if (isTauriRuntime()) {
    const file = await invokeTauri<LocalKnowledgeFile>("update_local_user_document", {
      file_id: fileId,
      payload: {
        name: params.name ?? null,
        folder_id: params.folderId ?? null,
        folder_id_provided: params.folderId !== undefined,
      },
    })
    return mapLocalFile(file)
  }

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
  if (isTauriRuntime()) {
    await invokeTauri<void>("delete_local_user_document", {
      file_id: fileId,
    })
    return
  }

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
  if (isTauriRuntime()) {
    const file = await invokeTauri<LocalKnowledgeFile>("retry_local_user_document", {
      file_id: fileId,
    })
    return mapLocalFile(file)
  }

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
  if (isTauriRuntime()) {
    const data = await invokeTauri<LocalKnowledgeChunkListResponse>(
      "list_local_user_document_chunks",
      {
        file_id: fileId,
        query: {
          offset: params?.offset ?? 0,
          limit: params?.limit ?? 20,
        },
      }
    )
    return {
      items: data.items.map((item) =>
        mapChunk({
          id: item.id,
          file_id: item.file_id,
          index: item.index,
          content: item.content,
          token_count: item.token_count,
        })
      ),
      total: data.total,
    }
  }

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

const INTERNAL_KNOWLEDGE_BASE = "/api/v1/internal/knowledge"

/**
 * Knowledge Ingestion & Review APIs (Internal)
 */
export async function ingestDocument(payload: {
  media_asset_id?: string
  raw_text?: string
  filename?: string
  folder_id?: string
  metadata?: Record<string, any>
}) {
  return request<any>({
    url: `${INTERNAL_KNOWLEDGE_BASE}/ingest`,
    method: "POST",
    data: payload,
  })
}

export async function fetchReviewTasks(params?: {
  status?: string
  asset_type?: string
  limit?: number
}) {
  return request<any[]>({
    url: `${INTERNAL_KNOWLEDGE_BASE}/reviews`,
    method: "GET",
    params,
  })
}

export async function getReviewTask(taskId: string) {
  return request<any>({
    url: `${INTERNAL_KNOWLEDGE_BASE}/reviews/${taskId}`,
    method: "GET",
  })
}

export async function submitReviewResult(
  taskId: string,
  payload: {
    action: "approve" | "reject" | "refine"
    reason?: string
    refined_payload?: Record<string, any>
  }
) {
  return request<any>({
    url: `${INTERNAL_KNOWLEDGE_BASE}/reviews/${taskId}/submit`,
    method: "POST",
    data: payload,
  })
}

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
