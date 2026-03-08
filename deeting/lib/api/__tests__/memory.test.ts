import { clearAllMemories, deleteMemory, fetchMemories, updateMemory } from "@/lib/api/memory"
import { request } from "@/lib/http"
import {
  clearLocalMemories,
  deleteLocalMemory,
  listLocalMemories,
  updateLocalMemory,
} from "@/lib/api/local-memory"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

jest.mock("@/lib/api/local-memory", () => ({
  clearLocalMemories: jest.fn(),
  deleteLocalMemory: jest.fn(),
  listLocalMemories: jest.fn(),
  updateLocalMemory: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>
const mockClearLocalMemories = clearLocalMemories as jest.MockedFunction<typeof clearLocalMemories>
const mockDeleteLocalMemory = deleteLocalMemory as jest.MockedFunction<typeof deleteLocalMemory>
const mockListLocalMemories = listLocalMemories as jest.MockedFunction<typeof listLocalMemories>
const mockUpdateLocalMemory = updateLocalMemory as jest.MockedFunction<typeof updateLocalMemory>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("memory api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockClearLocalMemories.mockReset()
    mockDeleteLocalMemory.mockReset()
    mockListLocalMemories.mockReset()
    mockUpdateLocalMemory.mockReset()
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
          category: "fact",
          tags: ["profile"],
          vitality: 0.7,
          last_accessed_at: null,
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
          payload: { source: "local", category: "fact", tags: ["profile"], vitality: 0.7 },
          session_id: null,
          assistant_id: null,
          category: "fact",
          source: null,
          tags: ["profile"],
          vitality: 0.7,
          last_accessed_at: null,
          created_at: "2026-03-04T00:00:00Z",
          updated_at: "2026-03-04T00:00:00Z",
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

  it("updates memory in tauri via local update command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockUpdateLocalMemory.mockResolvedValue({
      id: "memory-local-2",
      content: "after",
      session_id: "session-1",
      assistant_id: "assistant-1",
      meta_info: { foo: "bar" },
      category: "fact",
      source: "manual",
      tags: ["important"],
      vitality: 0.9,
      last_accessed_at: "2026-03-04T00:00:00Z",
      created_at: "2026-03-04T00:00:00Z",
      updated_at: "2026-03-04T00:00:01Z",
    })

    const result = await updateMemory("memory-local-2", { content: "after" })

    expect(result).toEqual({
      id: "memory-local-2",
      content: "after",
      payload: {
        foo: "bar",
        category: "fact",
        source: "manual",
        tags: ["important"],
        vitality: 0.9,
        last_accessed_at: "2026-03-04T00:00:00Z",
      },
      session_id: "session-1",
      assistant_id: "assistant-1",
      category: "fact",
      source: "manual",
      tags: ["important"],
      vitality: 0.9,
      last_accessed_at: "2026-03-04T00:00:00Z",
      created_at: "2026-03-04T00:00:00Z",
      updated_at: "2026-03-04T00:00:01Z",
    })
    expect(mockUpdateLocalMemory).toHaveBeenCalledWith("memory-local-2", {
      content: "after",
    })
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

  it("surfaces local update failures in tauri", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockUpdateLocalMemory.mockRejectedValueOnce(new Error("update failed"))

    await expect(updateMemory("memory-local-4", { content: "after" })).rejects.toThrow(
      "update failed"
    )
    expect(mockUpdateLocalMemory).toHaveBeenCalledWith("memory-local-4", { content: "after" })
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
