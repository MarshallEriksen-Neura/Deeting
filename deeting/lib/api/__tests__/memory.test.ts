import { clearAllMemories, deleteMemory, fetchMemories, updateMemory } from "@/lib/api/memory"
import { request } from "@/lib/http"
import {
  appendLocalMemory,
  clearLocalMemories,
  deleteLocalMemory,
  listLocalMemories,
} from "@/lib/api/local-memory"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

jest.mock("@/lib/api/local-memory", () => ({
  appendLocalMemory: jest.fn(),
  clearLocalMemories: jest.fn(),
  deleteLocalMemory: jest.fn(),
  listLocalMemories: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>
const mockAppendLocalMemory = appendLocalMemory as jest.MockedFunction<typeof appendLocalMemory>
const mockClearLocalMemories = clearLocalMemories as jest.MockedFunction<typeof clearLocalMemories>
const mockDeleteLocalMemory = deleteLocalMemory as jest.MockedFunction<typeof deleteLocalMemory>
const mockListLocalMemories = listLocalMemories as jest.MockedFunction<typeof listLocalMemories>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("memory api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockAppendLocalMemory.mockReset()
    mockClearLocalMemories.mockReset()
    mockDeleteLocalMemory.mockReset()
    mockListLocalMemories.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("uses local memory list in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockListLocalMemories.mockResolvedValue({
      items: [
        {
          id: "memory-local-1",
          content: "local content",
          session_id: null,
          assistant_id: null,
          meta_info: { source: "local" },
          created_at: "2026-03-04T00:00:00Z",
          updated_at: "2026-03-04T00:00:00Z",
        },
      ],
      next_cursor: "next-1",
      has_more: true,
    })

    const result = await fetchMemories({ limit: 10, cursor: null })

    expect(result).toEqual({
      items: [
        {
          id: "memory-local-1",
          content: "local content",
          payload: { source: "local" },
        },
      ],
      next_cursor: "next-1",
    })
    expect(mockListLocalMemories).toHaveBeenCalledWith({
      limit: 10,
      cursor: null,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("updates memory in tauri by append then delete", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockListLocalMemories.mockResolvedValue({
      items: [
        {
          id: "memory-local-2",
          content: "before",
          session_id: "session-1",
          assistant_id: "assistant-1",
          meta_info: { foo: "bar" },
          created_at: "2026-03-04T00:00:00Z",
          updated_at: "2026-03-04T00:00:00Z",
        },
      ],
      next_cursor: null,
      has_more: false,
    })
    mockAppendLocalMemory.mockResolvedValue({
      id: "memory-local-3",
      content: "after",
      session_id: "session-1",
      assistant_id: "assistant-1",
      meta_info: { foo: "bar" },
      created_at: "2026-03-04T00:00:01Z",
      updated_at: "2026-03-04T00:00:01Z",
    })
    mockDeleteLocalMemory.mockResolvedValue({ id: "memory-local-2", deleted: true })

    const result = await updateMemory("memory-local-2", { content: "after" })

    expect(result).toEqual({
      id: "memory-local-3",
      content: "after",
      payload: { foo: "bar" },
    })
    expect(mockAppendLocalMemory).toHaveBeenCalledWith({
      content: "after",
      session_id: "session-1",
      assistant_id: "assistant-1",
      meta_info: { foo: "bar" },
    })
    expect(mockDeleteLocalMemory).toHaveBeenCalledWith("memory-local-2")
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("uses cloud endpoints outside tauri", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({})

    await deleteMemory("memory-cloud-1")
    await clearAllMemories()

    expect(mockRequest).toHaveBeenNthCalledWith(1, {
      url: "/api/v1/memory/memory-cloud-1",
      method: "DELETE",
    })
    expect(mockRequest).toHaveBeenNthCalledWith(2, {
      url: "/api/v1/memory",
      method: "DELETE",
    })
  })

  it("cleans up appended record when local delete fails during update", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockListLocalMemories.mockResolvedValue({
      items: [
        {
          id: "memory-local-4",
          content: "before",
          session_id: null,
          assistant_id: null,
          meta_info: null,
          created_at: "2026-03-04T00:00:00Z",
          updated_at: "2026-03-04T00:00:00Z",
        },
      ],
      next_cursor: null,
      has_more: false,
    })
    mockAppendLocalMemory.mockResolvedValue({
      id: "memory-local-5",
      content: "after",
      session_id: null,
      assistant_id: null,
      meta_info: null,
      created_at: "2026-03-04T00:00:01Z",
      updated_at: "2026-03-04T00:00:01Z",
    })
    mockDeleteLocalMemory.mockRejectedValueOnce(new Error("delete failed")).mockResolvedValueOnce({
      id: "memory-local-5",
      deleted: true,
    })

    await expect(updateMemory("memory-local-4", { content: "after" })).rejects.toThrow(
      "delete failed"
    )
    expect(mockDeleteLocalMemory).toHaveBeenNthCalledWith(1, "memory-local-4")
    expect(mockDeleteLocalMemory).toHaveBeenNthCalledWith(2, "memory-local-5")
  })

  it("uses local clear and delete in tauri", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockDeleteLocalMemory.mockResolvedValue({ id: "memory-local-6", deleted: true })
    mockClearLocalMemories.mockResolvedValue({ cleared: 1 })

    await deleteMemory("memory-local-6")
    await clearAllMemories()

    expect(mockDeleteLocalMemory).toHaveBeenCalledWith("memory-local-6")
    expect(mockClearLocalMemories).toHaveBeenCalledWith()
    expect(mockRequest).not.toHaveBeenCalled()
  })
})
