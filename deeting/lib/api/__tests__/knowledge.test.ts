import {
  createFolder,
  createLocalUserDocument,
  deleteFile,
  deleteFolder,
  fetchFileChunks,
  getFile,
  fetchKnowledgeStats,
  fetchKnowledgeTree,
  listLocalUserDocuments,
  retryFile,
  updateFile,
  updateFolder,
} from "@/lib/api/knowledge"
import { request } from "@/lib/http"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
  apiClient: {
    post: jest.fn(),
  },
}))

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>
const mockInvoke = invoke as jest.MockedFunction<typeof invoke>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("knowledge api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
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
      total_bytes: 1024 * 1024,
      total_vectors: 8,
      total_files: 2,
      total_folders: 1,
    } as unknown)

    const stats = await fetchKnowledgeStats()

    expect(stats.usedBytes).toBe(1024)
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
      file_id: "d-10",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "update_local_user_document", {
      file_id: "d-10",
      payload: {
        name: "note-renamed.md",
        folder_id: "f-1",
        folder_id_provided: true,
      },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "delete_local_user_document", {
      file_id: "d-10",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(4, "retry_local_user_document", {
      file_id: "d-10",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(5, "list_local_user_document_chunks", {
      file_id: "d-10",
      query: {
        offset: 0,
        limit: 20,
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })
})
