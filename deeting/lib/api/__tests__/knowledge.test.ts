import {
  createFolder,
  createLocalUserDocument,
  deleteFile,
  deleteFolder,
  fetchFileChunks,
  getKnowledgeUploadAccept,
  getKnowledgeUploadFileTypes,
  getKnowledgeUploadMaxBytes,
  getFile,
  getFileDownloadUrl,
  fetchKnowledgeStats,
  fetchKnowledgeTree,
  listLocalUserDocuments,
  retryFile,
  splitKnowledgeUploadFiles,
  uploadFile,
  updateFile,
  updateFolder,
} from "@/lib/api/knowledge"
import { request } from "@/lib/http"
import { extractPdfTextFromFile } from "@/lib/utils/pdf"
import { invoke } from "@tauri-apps/api/core"
import { TextDecoder, TextEncoder } from "util"

Object.assign(globalThis, { TextEncoder, TextDecoder })

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
  apiClient: {
    post: jest.fn(),
  },
}))

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

jest.mock("@/lib/utils/pdf", () => ({
  extractPdfTextFromFile: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>
const mockInvoke = invoke as jest.MockedFunction<typeof invoke>
const mockExtractPdfTextFromFile = extractPdfTextFromFile as jest.MockedFunction<
  typeof extractPdfTextFromFile
>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

function createStoredZip(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder()
  const fileEntries = Object.entries(files).map(([name, content]) => ({
    name,
    nameBytes: encoder.encode(name),
    contentBytes: encoder.encode(content),
  }))

  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let offset = 0

  for (const entry of fileEntries) {
    const localHeader = new Uint8Array(30)
    const localView = new DataView(localHeader.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, 0, true)
    localView.setUint32(14, 0, true)
    localView.setUint32(18, entry.contentBytes.length, true)
    localView.setUint32(22, entry.contentBytes.length, true)
    localView.setUint16(26, entry.nameBytes.length, true)
    localView.setUint16(28, 0, true)
    localChunks.push(localHeader, entry.nameBytes, entry.contentBytes)

    const centralHeader = new Uint8Array(46)
    const centralView = new DataView(centralHeader.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, 0, true)
    centralView.setUint32(16, 0, true)
    centralView.setUint32(20, entry.contentBytes.length, true)
    centralView.setUint32(24, entry.contentBytes.length, true)
    centralView.setUint16(28, entry.nameBytes.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, offset, true)
    centralChunks.push(centralHeader, entry.nameBytes)

    offset += localHeader.length + entry.nameBytes.length + entry.contentBytes.length
  }

  const centralDirectorySize = centralChunks.reduce((total, chunk) => total + chunk.length, 0)
  const endOfCentralDirectory = new Uint8Array(22)
  const eocdView = new DataView(endOfCentralDirectory.buffer)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(8, fileEntries.length, true)
  eocdView.setUint16(10, fileEntries.length, true)
  eocdView.setUint32(12, centralDirectorySize, true)
  eocdView.setUint32(16, offset, true)
  eocdView.setUint16(20, 0, true)

  const totalSize =
    offset + centralDirectorySize + endOfCentralDirectory.length
  const output = new Uint8Array(totalSize)
  let cursor = 0
  for (const chunk of [...localChunks, ...centralChunks, endOfCentralDirectory]) {
    output.set(chunk, cursor)
    cursor += chunk.length
  }
  return output
}

function attachArrayBuffer(file: File, bytes: Uint8Array): File {
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  })
  return file
}

function createMinimalDocxFile(name = "sample.docx"): File {
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:body>" +
    "<w:p><w:r><w:t>Hello</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>world</w:t></w:r></w:p>" +
    "</w:body>" +
    "</w:document>"
  const bytes = createStoredZip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    "word/document.xml": documentXml,
  })
  return attachArrayBuffer(new File([bytes], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }), bytes)
}

describe("knowledge api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    mockExtractPdfTextFromFile.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("fetches knowledge tree via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      folders: [
        {
          id: "f-1",
          name: "Root",
          parent_id: null,
          file_count: 1,
          created_at: "2026-03-03T00:00:00Z",
          updated_at: "2026-03-03T00:00:00Z",
        },
      ],
      files: [
        {
          id: "d-1",
          name: "doc.md",
          file_type: "md",
          size: 1024,
          status: "indexed",
          chunks: 3,
          error_message: null,
          folder_id: null,
          created_at: "2026-03-03T00:00:00Z",
          updated_at: "2026-03-03T00:00:00Z",
        },
      ],
      breadcrumb: [{ id: null, name: "All Files" }],
    } as unknown)

    const tree = await fetchKnowledgeTree({ parentId: null, sortField: "createdAt", sortDirection: "desc" })

    expect(tree.folders[0]?.id).toBe("f-1")
    expect(tree.files[0]?.status).toBe("active")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_knowledge_tree", {
      query: {
        parent_id: null,
        q: null,
        sort_field: "created_at",
        sort_direction: "desc",
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("fetches local knowledge stats via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      used_bytes: 1024,
      total_vectors: 8,
      total_files: 2,
      total_folders: 1,
    } as unknown)

    const stats = await fetchKnowledgeStats()

    expect(stats.usedBytes).toBe(1024)
    expect(stats.totalBytes).toBeNull()
    expect(stats.totalFiles).toBe(2)
    expect(mockInvoke).toHaveBeenCalledWith("get_local_knowledge_stats", undefined)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("handles folder CRUD via tauri commands", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce({
        id: "f-2",
        name: "A",
        parent_id: null,
        file_count: 0,
        created_at: "2026-03-03T00:00:00Z",
        updated_at: "2026-03-03T00:00:00Z",
      } as unknown)
      .mockResolvedValueOnce({
        id: "f-2",
        name: "B",
        parent_id: null,
        file_count: 0,
        created_at: "2026-03-03T00:00:00Z",
        updated_at: "2026-03-03T00:01:00Z",
      } as unknown)
      .mockResolvedValueOnce(undefined as unknown)

    const created = await createFolder({ name: "A" })
    const updated = await updateFolder("f-2", { name: "B" })
    await deleteFolder("f-2", true)

    expect(created.name).toBe("A")
    expect(updated.name).toBe("B")
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "create_local_knowledge_folder", {
      payload: { name: "A", parent_id: null },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "update_local_knowledge_folder", {
      folder_id: "f-2",
      payload: { name: "B" },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "delete_local_knowledge_folder", {
      folder_id: "f-2",
      recursive: true,
    })
  })

  it("lists and creates local user documents via tauri commands", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce([
        {
          id: "d-2",
          name: "file.json",
          file_type: "json",
          size: 12,
          status: "failed",
          chunks: 0,
          error_message: "parse error",
          folder_id: null,
          created_at: "2026-03-03T00:00:00Z",
          updated_at: "2026-03-03T00:00:00Z",
        },
      ] as unknown)
      .mockResolvedValueOnce({
        id: "d-3",
        name: "file.txt",
        file_type: "txt",
        size: 8,
        status: "processing",
        chunks: null,
        error_message: null,
        folder_id: null,
        created_at: "2026-03-03T00:00:00Z",
        updated_at: "2026-03-03T00:00:00Z",
      } as unknown)

    const listed = await listLocalUserDocuments({ q: "file" })
    const created = await createLocalUserDocument({ filename: "file.txt" })

    expect(listed[0]?.status).toBe("failed")
    expect(created.status).toBe("processing")
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "list_local_user_documents", {
      query: {
        folder_id: null,
        status: null,
        q: "file",
      },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "create_local_user_document", {
      payload: {
        filename: "file.txt",
        folder_id: null,
        media_asset_id: null,
        status: null,
        error_message: null,
        chunk_count: null,
        embedding_model: null,
        meta_info: null,
      },
    })
  })

  it("falls back to web api outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      id: "f-web",
      name: "Web",
      parent_id: null,
      file_count: 0,
      created_at: "2026-03-03T00:00:00Z",
      updated_at: "2026-03-03T00:00:00Z",
    })

    const folder = await createFolder({ name: "Web" })

    expect(folder.id).toBe("f-web")
    expect(mockRequest).toHaveBeenCalledWith({
      url: "/api/v1/documents/folders",
      method: "POST",
      data: { name: "Web", parent_id: null },
    })
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("routes file operations to tauri commands in desktop runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce({
        id: "d-10",
        name: "note.md",
        file_type: "md",
        size: 512,
        status: "indexed",
        chunks: 2,
        error_message: null,
        folder_id: null,
        created_at: "2026-03-03T00:00:00Z",
        updated_at: "2026-03-03T00:00:00Z",
      } as unknown)
      .mockResolvedValueOnce({
        id: "d-10",
        name: "note-renamed.md",
        file_type: "md",
        size: 512,
        status: "indexed",
        chunks: 2,
        error_message: null,
        folder_id: "f-1",
        created_at: "2026-03-03T00:00:00Z",
        updated_at: "2026-03-03T00:01:00Z",
      } as unknown)
      .mockResolvedValueOnce(undefined as unknown)
      .mockResolvedValueOnce({
        id: "d-10",
        name: "note-renamed.md",
        file_type: "md",
        size: 512,
        status: "processing",
        chunks: null,
        error_message: null,
        folder_id: "f-1",
        created_at: "2026-03-03T00:00:00Z",
        updated_at: "2026-03-03T00:02:00Z",
      } as unknown)
      .mockResolvedValueOnce({
        items: [
          {
            id: "c-1",
            file_id: "d-10",
            index: 0,
            content: "chunk content",
            token_count: 2,
          },
        ],
        total: 1,
        offset: 0,
        limit: 20,
      } as unknown)

    const file = await getFile("d-10")
    const updated = await updateFile("d-10", { name: "note-renamed.md", folderId: "f-1" })
    await deleteFile("d-10")
    const retried = await retryFile("d-10")
    const chunks = await fetchFileChunks("d-10")

    expect(file.id).toBe("d-10")
    expect(updated.name).toBe("note-renamed.md")
    expect(retried.status).toBe("processing")
    expect(chunks.total).toBe(1)
    expect(chunks.items[0]?.id).toBe("c-1")
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "get_local_user_document", {
      fileId: "d-10",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "update_local_user_document", {
      fileId: "d-10",
      payload: {
        name: "note-renamed.md",
        folder_id: "f-1",
        folder_id_provided: true,
      },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "delete_local_user_document", {
      fileId: "d-10",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(4, "retry_local_user_document", {
      fileId: "d-10",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(5, "list_local_user_document_chunks", {
      fileId: "d-10",
      query: {
        offset: 0,
        limit: 20,
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("uploads local text file via tauri document command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    const progress = jest.fn()
    const originalFetch = global.fetch
    global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response)
    mockInvoke
      .mockResolvedValueOnce({
        provider: "cloudflare_r2_s3",
        object_key: "desktop/uploads/knowledge/local.txt",
        upload_url: "https://example.r2.cloudflarestorage.com/upload",
        method: "PUT",
        headers: {},
        asset_url: "https://cdn.example.com/knowledge/local.txt",
        expires_at: "2026-03-10T00:15:00Z",
      } as unknown)
      .mockResolvedValueOnce({
        id: "d-20",
        name: "local.txt",
        file_type: "txt",
        size: 11,
        status: "indexed",
        chunks: 1,
        error_message: null,
        folder_id: null,
        created_at: "2026-03-03T00:00:00Z",
        updated_at: "2026-03-03T00:00:01Z",
      } as unknown)

    const file = new File(["hello world"], "local.txt", { type: "text/plain" })
    const uploaded = await uploadFile(file, null, progress)

    expect(uploaded.id).toBe("d-20")
    expect(uploaded.status).toBe("active")
    expect(progress).toHaveBeenNthCalledWith(1, 20)
    expect(progress).toHaveBeenNthCalledWith(2, 80)
    expect(progress).toHaveBeenNthCalledWith(3, 100)
    expect(mockInvoke).toHaveBeenNthCalledWith(
      1,
      "prepare_local_desktop_object_storage_upload",
      {
        payload: {
          object_key: expect.stringContaining("knowledge/"),
          content_type: "text/plain",
          expires_seconds: 900,
        },
      }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "create_local_user_document", {
      payload: {
        filename: "local.txt",
        folder_id: null,
        media_asset_id: "desktop/uploads/knowledge/local.txt",
        status: "processing",
        error_message: null,
        chunk_count: null,
        embedding_model: null,
        meta_info: {
          file_type: "txt",
          size: 11,
          source: "desktop-local-upload",
          object_storage: {
            provider: "cloudflare_r2_s3",
            object_key: "desktop/uploads/knowledge/local.txt",
            asset_url: "https://cdn.example.com/knowledge/local.txt",
          },
          raw_text: "hello world",
        },
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
    global.fetch = originalFetch
  })

  it("limits local upload affordances to offline doc-aware types in tauri runtime", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}

    expect(getKnowledgeUploadFileTypes()).toEqual(["pdf", "txt", "docx", "md", "csv", "html", "json"])
    expect(getKnowledgeUploadAccept()).toBe(".pdf,.txt,.docx,.md,.csv,.html,.json")
    expect(getKnowledgeUploadMaxBytes()).toBeNull()

    const { accepted, rejected } = splitKnowledgeUploadFiles([
      { name: "notes.md" },
      { name: "sample1.docx" },
      { name: "paper.pdf" },
    ])

    expect(accepted).toEqual([{ name: "notes.md" }, { name: "sample1.docx" }, { name: "paper.pdf" }])
    expect(rejected).toEqual([])
  })

  it("uploads local docx file via tauri document command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    const originalFetch = global.fetch
    global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response)
    mockInvoke
      .mockResolvedValueOnce({
        provider: "cloudflare_r2_s3",
        object_key: "desktop/uploads/knowledge/sample.docx",
        upload_url: "https://example.r2.cloudflarestorage.com/upload",
        method: "PUT",
        headers: {},
        asset_url: "https://cdn.example.com/knowledge/sample.docx",
        expires_at: "2026-03-10T00:15:00Z",
      } as unknown)
      .mockResolvedValueOnce({
        id: "d-22",
        name: "sample.docx",
        file_type: "docx",
        size: 512,
        status: "indexed",
        chunks: 1,
        error_message: null,
        folder_id: null,
        created_at: "2026-03-03T00:00:00Z",
        updated_at: "2026-03-03T00:00:01Z",
      } as unknown)

    const uploaded = await uploadFile(createMinimalDocxFile())

    expect(uploaded.id).toBe("d-22")
    expect(uploaded.status).toBe("active")
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "create_local_user_document", {
      payload: expect.objectContaining({
        filename: "sample.docx",
        folder_id: null,
        status: "processing",
        meta_info: expect.objectContaining({
          file_type: "docx",
          raw_text: expect.stringMatching(/Hello\s+world/),
        }),
      }),
    })
    global.fetch = originalFetch
  })

  it("gets local knowledge download url via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue("https://cdn.example.com/knowledge/local.txt" as unknown)

    const url = await getFileDownloadUrl("d-20")

    expect(url).toBe("https://cdn.example.com/knowledge/local.txt")
    expect(mockInvoke).toHaveBeenCalledWith("get_local_user_document_download_url", {
      fileId: "d-20",
    })
  })

  it("uploads local pdf file via tauri document command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    const originalFetch = global.fetch
    global.fetch = jest.fn().mockResolvedValue({ ok: true } as Response)
    mockExtractPdfTextFromFile.mockResolvedValue("Hello PDF")
    mockInvoke
      .mockResolvedValueOnce({
        provider: "cloudflare_r2_s3",
        object_key: "desktop/uploads/knowledge/paper.pdf",
        upload_url: "https://example.r2.cloudflarestorage.com/upload",
        method: "PUT",
        headers: {},
        asset_url: "https://cdn.example.com/knowledge/paper.pdf",
        expires_at: "2026-03-10T00:15:00Z",
      } as unknown)
      .mockResolvedValueOnce({
        id: "d-21",
        name: "paper.pdf",
        file_type: "pdf",
        size: 4,
        status: "indexed",
        chunks: 2,
        error_message: null,
        folder_id: null,
        created_at: "2026-03-03T00:00:00Z",
        updated_at: "2026-03-03T00:00:01Z",
      } as unknown)

    const file = new File(["%PDF"], "paper.pdf", { type: "application/pdf" })

    const uploaded = await uploadFile(file)

    expect(uploaded.id).toBe("d-21")
    expect(uploaded.status).toBe("active")
    expect(mockExtractPdfTextFromFile).toHaveBeenCalledWith(file)
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "create_local_user_document", {
      payload: expect.objectContaining({
        filename: "paper.pdf",
        status: "processing",
        folder_id: null,
        meta_info: expect.objectContaining({
          file_type: "pdf",
          raw_text: "Hello PDF",
        }),
      }),
    })
    expect(mockRequest).not.toHaveBeenCalled()
    global.fetch = originalFetch
  })
})
