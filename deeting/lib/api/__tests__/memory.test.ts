import {
  clearAllMemories,
  deleteMemory,
  fetchMemories,
  listMemorySnapshots,
  rollbackMemory,
  searchMemories,
  updateMemory,
} from "@/lib/api/memory"
import { request } from "@/lib/http"
import {
  clearLocalMemories,
  deleteLocalMemory,
  listLocalMemories,
  listMemorySnapshots as listLocalMemorySnapshots,
  rollbackMemory as rollbackLocalMemory,
  searchLocalMemories,
  updateLocalMemory,
} from "@/lib/api/local-memory"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
}))

jest.mock("@/lib/api/local-memory", () => ({
  clearLocalMemories: jest.fn(),
  deleteLocalMemory: jest.fn(),
  listLocalMemories: jest.fn(),
  listMemorySnapshots: jest.fn(),
  rollbackMemory: jest.fn(),
  searchLocalMemories: jest.fn(),
  updateLocalMemory: jest.fn(),
}))

const mockRequest = request as jest.MockedFunction<typeof request>
const mockClearLocalMemories = clearLocalMemories as jest.MockedFunction<typeof clearLocalMemories>
const mockDeleteLocalMemory = deleteLocalMemory as jest.MockedFunction<typeof deleteLocalMemory>
const mockListLocalMemories = listLocalMemories as jest.MockedFunction<typeof listLocalMemories>
const mockListMemorySnapshots = listLocalMemorySnapshots as jest.MockedFunction<typeof listLocalMemorySnapshots>
const mockRollbackLocalMemory = rollbackLocalMemory as jest.MockedFunction<typeof rollbackLocalMemory>
const mockSearchLocalMemories = searchLocalMemories as jest.MockedFunction<typeof searchLocalMemories>
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
    mockListMemorySnapshots.mockReset()
    mockRollbackLocalMemory.mockReset()
    mockSearchLocalMemories.mockReset()
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

    expect(result).toMatchObject({
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

    expect(result).toMatchObject({
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

  it("passes governance metadata through unified tauri update", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockUpdateLocalMemory.mockResolvedValue({
      id: "memory-local-gov-1",
      content: "prefers short answers",
      session_id: null,
      assistant_id: null,
      meta_info: {
        recall_when: "when answering style preferences",
        memory_tier: "core",
        is_core: true,
        is_boot: true,
      },
      category: "preference",
      source: "manual",
      tags: ["style"],
      vitality: 1,
      last_accessed_at: null,
      created_at: "2026-03-04T00:00:00Z",
      updated_at: "2026-03-04T00:00:01Z",
    })

    const result = await updateMemory("memory-local-gov-1", {
      content: "prefers short answers",
      recall_when: "when answering style preferences",
      memory_tier: "core",
      is_core: true,
      is_boot: true,
    })

    expect(mockUpdateLocalMemory).toHaveBeenCalledWith("memory-local-gov-1", {
      content: "prefers short answers",
      meta_info: {
        recall_when: "when answering style preferences",
        memory_tier: "core",
        is_core: true,
        is_boot: true,
      },
    })
    expect(result).toMatchObject({
      recall_when: "when answering style preferences",
      memory_tier: "core",
      is_core: true,
      is_boot: true,
    })
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

  it("uses unified local search in tauri", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockSearchLocalMemories.mockResolvedValue({
      items: [
        {
          id: "memory-local-search-1",
          content: "matched content",
          session_id: null,
          assistant_id: null,
          meta_info: { source: "local-search" },
          score: 0.88,
          category: "fact",
          source: "manual",
          tags: ["search"],
          vitality: 0.6,
          last_accessed_at: null,
          created_at: "2026-03-04T00:00:00Z",
          updated_at: "2026-03-04T00:00:00Z",
        },
      ],
    })

    const result = await searchMemories({ query: "matched", limit: 5, category: "fact" })

    expect(result[0]).toMatchObject({
      id: "memory-local-search-1",
      content: "matched content",
      score: 0.88,
      category: "fact",
    })
    expect(mockSearchLocalMemories).toHaveBeenCalledWith({
      query: "matched",
      limit: 5,
      session_id: null,
      assistant_id: null,
      category: "fact",
      source: null,
      tags: null,
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("uses unified snapshot APIs in tauri", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockListMemorySnapshots.mockResolvedValue([
      {
        id: "snap-1",
        memory_id: "memory-local-7",
        action: "update",
        old_content: "before",
        new_content: "after",
        old_metadata: { source: "manual" },
        new_metadata: { source: "manual" },
        created_at: "2026-03-04T00:00:00Z",
      },
    ])
    mockRollbackLocalMemory.mockResolvedValue({
      id: "memory-local-7",
      content: "before",
      session_id: null,
      assistant_id: null,
      meta_info: null,
      category: null,
      source: null,
      tags: null,
      vitality: null,
      last_accessed_at: null,
      created_at: "2026-03-04T00:00:00Z",
      updated_at: "2026-03-04T00:00:01Z",
    })

    const snapshots = await listMemorySnapshots("memory-local-7")
    const rollback = await rollbackMemory("memory-local-7", "snap-1")

    expect(snapshots).toEqual([
      {
        id: "snap-1",
        memory_id: "memory-local-7",
        action: "update",
        old_content: "before",
        new_content: "after",
        old_metadata: { source: "manual" },
        new_metadata: { source: "manual" },
        created_at: "2026-03-04T00:00:00Z",
      },
    ])
    expect(rollback).toEqual({
      success: true,
      memory_point_id: "memory-local-7",
      restored_content: "before",
    })
    expect(mockListMemorySnapshots).toHaveBeenCalledWith("memory-local-7", 20)
    expect(mockRollbackLocalMemory).toHaveBeenCalledWith("snap-1")
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("uses unified cloud snapshot and search endpoints outside tauri", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest
      .mockResolvedValueOnce([
        {
          id: "memory-cloud-search-1",
          content: "cloud result",
          payload: { source: "cloud" },
          score: 0.93,
        },
      ])
      .mockResolvedValueOnce({
        items: [
          {
            id: "snap-cloud-1",
            memory_point_id: "memory-cloud-2",
            action: "rollback",
            old_content: "before",
            new_content: "after",
            created_at: "2026-03-04T00:00:00Z",
            updated_at: "2026-03-04T00:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        memory_point_id: "memory-cloud-2",
        restored_content: "before",
      })

    const results = await searchMemories({ query: "cloud", limit: 3 })
    const snapshots = await listMemorySnapshots("memory-cloud-2", 10)
    const rollback = await rollbackMemory("memory-cloud-2", "snap-cloud-1")

    expect(results).toEqual([
      {
        id: "memory-cloud-search-1",
        content: "cloud result",
        payload: { source: "cloud" },
        score: 0.93,
      },
    ])
    expect(snapshots).toEqual([
      {
        id: "snap-cloud-1",
        memory_id: "memory-cloud-2",
        action: "rollback",
        old_content: "before",
        new_content: "after",
        old_metadata: null,
        new_metadata: null,
        created_at: "2026-03-04T00:00:00Z",
        updated_at: "2026-03-04T00:00:00Z",
      },
    ])
    expect(rollback).toEqual({
      success: true,
      memory_point_id: "memory-cloud-2",
      restored_content: "before",
    })
    expect(mockRequest).toHaveBeenNthCalledWith(1, {
      url: "/api/v1/memory/search",
      params: {
        q: "cloud",
        limit: 3,
        session_id: undefined,
        assistant_id: undefined,
        category: undefined,
        source: undefined,
        tags: undefined,
      },
    })
    expect(mockRequest).toHaveBeenNthCalledWith(2, {
      url: "/api/v1/memory/memory-cloud-2/snapshots",
      params: { limit: 10 },
    })
    expect(mockRequest).toHaveBeenNthCalledWith(3, {
      url: "/api/v1/memory/memory-cloud-2/rollback",
      method: "POST",
      data: { snapshot_id: "snap-cloud-1" },
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
