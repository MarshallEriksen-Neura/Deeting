/**
 * Knowledge Base Types
 *
 * Types for the knowledge base file management system.
 * Files are uploaded, parsed, embedded, and indexed in Qdrant for RAG retrieval.
 */

/** Document processing status in the RAG pipeline */
export type FileStatus = "active" | "processing" | "failed"

/** Supported file types for knowledge base upload */
export type FileType =
  | "pdf"
  | "txt"
  | "docx"
  | "md"
  | "csv"
  | "xlsx"
  | "html"
  | "json"
  | "png"
  | "jpg"
  | "jpeg"
  | "webp"

/** A document in the knowledge base */
export interface KnowledgeFile {
  id: string
  name: string
  type: FileType
  /** File size in bytes */
  size: number
  /** Current status in the RAG pipeline */
  status: FileStatus
  /** Number of vector chunks in Qdrant (null while processing) */
  chunks: number | null
  /** Error message when status is "failed" */
  errorMessage?: string
  /** Parent folder ID (null = root level) */
  folderId: string | null
  createdAt: string
  updatedAt: string
  /** Presigned share URL (optional) */
  shareUrl?: string
}

/** A folder for organizing knowledge base documents */
export interface KnowledgeFolder {
  id: string
  name: string
  /** Parent folder ID (null = root level) */
  parentId: string | null
  /** Number of files directly in this folder */
  fileCount: number
  createdAt: string
}

/** Storage and vector usage statistics */
export interface KnowledgeStats {
  usedBytes: number
  totalBytes?: number | null
  totalVectors: number
  totalFiles: number
  totalFolders: number
}

/** A text chunk stored in Qdrant for a given document */
export interface KnowledgeChunk {
  id: string
  fileId: string
  /** Chunk index within the document (0-based) */
  index: number
  /** The actual text content of this chunk */
  content: string
  /** Number of tokens in this chunk */
  tokenCount: number
}

/** Sort options for the knowledge table */
export type KnowledgeSortField = "name" | "size" | "status" | "chunks" | "createdAt"
export type SortDirection = "asc" | "desc"
