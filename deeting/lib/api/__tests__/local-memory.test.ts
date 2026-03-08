import {
  appendLocalMemory,
  clearLocalMemories,
  deleteLocalMemory,
  listLocalMemories,
  searchLocalMemories,
  updateLocalMemory,
} from "@/lib/api/local-memory"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

const mockInvoke = invoke as jest.MockedFunction<typeof invoke>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("local memory apis", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
  })

  afterEach(() => {
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("appends local memory via tauri command", async () => {
    mockInvoke.mockResolvedValueOnce({
      id: "memory-1",
      content: "记住用户偏好",
      session_id: "session-1",
      assistant_id: "assistant-1",
      meta_info: { source: "chat" },
      created_at: "2026-03-02T00:00:00Z",
      updated_at: "2026-03-02T00:00:00Z",
    } as never)

    const result = await appendLocalMemory({
      content: "记住用户偏好",
      session_id: "session-1",
      assistant_id: "assistant-1",
      meta_info: { source: "chat" },
    })

    expect(result.id).toBe("memory-1")
    expect(mockInvoke).toHaveBeenCalledWith("append_local_memory", {
      payload: {
        content: "记住用户偏好",
        session_id: "session-1",
        assistant_id: "assistant-1",
        meta_info: { source: "chat" },
        category: null,
        source: null,
        tags: null,
      },
    })
  })

  it("lists local memories via tauri command", async () => {
    mockInvoke.mockResolvedValueOnce({
      items: [
        {
          id: "memory-2",
          content: "A",
          session_id: null,
          assistant_id: null,
          meta_info: null,
          created_at: "2026-03-02T00:00:00Z",
          updated_at: "2026-03-02T00:00:00Z",
        },
      ],
      next_cursor: null,
      has_more: false,
    } as never)

    const result = await listLocalMemories({ limit: 20, session_id: "s1" })

    expect(result.items).toHaveLength(1)
    expect(mockInvoke).toHaveBeenCalledWith("list_local_memories", {
      query: {
        cursor: null,
        limit: 20,
        session_id: "s1",
        assistant_id: null,
      },
    })
  })

  it("deletes and clears local memories via tauri command", async () => {
    mockInvoke
      .mockResolvedValueOnce({ id: "memory-3", deleted: true } as never)
      .mockResolvedValueOnce({ cleared: 2 } as never)

    const deleted = await deleteLocalMemory("memory-3")
    const cleared = await clearLocalMemories({ assistant_id: "assistant-2" })

    expect(deleted.deleted).toBe(true)
    expect(cleared.cleared).toBe(2)
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "delete_local_memory", { id: "memory-3" })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "clear_local_memories", {
      payload: {
        session_id: null,
        assistant_id: "assistant-2",
      },
    })
  })

  it("searches and updates local memories via tauri command", async () => {
    mockInvoke
      .mockResolvedValueOnce({
        items: [
          {
            id: "memory-4",
            content: "记住他喜欢黑咖啡",
            session_id: null,
            assistant_id: null,
            meta_info: { source: "chat" },
            category: "preference",
            source: "manual",
            tags: ["coffee", "taste"],
            vitality: 0.82,
            last_accessed_at: "2026-03-03T00:00:00Z",
            score: 0.93,
            created_at: "2026-03-02T00:00:00Z",
            updated_at: "2026-03-03T00:00:00Z",
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        id: "memory-4",
        content: "记住他只喝美式黑咖啡",
        session_id: null,
        assistant_id: null,
        meta_info: { source: "chat" },
        category: "preference",
        source: "manual",
        tags: ["coffee"],
        vitality: 0.82,
        last_accessed_at: "2026-03-03T00:00:00Z",
        created_at: "2026-03-02T00:00:00Z",
        updated_at: "2026-03-04T00:00:00Z",
      } as never)

    const search = await searchLocalMemories({
      query: "黑咖啡",
      limit: 5,
      category: "preference",
      source: "manual",
      tags: ["coffee"],
    })
    const updated = await updateLocalMemory("memory-4", {
      content: "记住他只喝美式黑咖啡",
      category: "preference",
      source: "manual",
      tags: ["coffee"],
    })

    expect(search.items[0]?.source).toBe("manual")
    expect(updated.id).toBe("memory-4")
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "search_local_memories", {
      query: {
        query: "黑咖啡",
        limit: 5,
        session_id: null,
        assistant_id: null,
        category: "preference",
        source: "manual",
        tags: ["coffee"],
      },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "update_local_memory", {
      id: "memory-4",
      payload: {
        content: "记住他只喝美式黑咖啡",
        meta_info: null,
        category: "preference",
        source: "manual",
        tags: ["coffee"],
      },
    })
  })

  it("throws outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"

    await expect(listLocalMemories()).rejects.toThrow(
      "local memory api is only supported in Tauri runtime"
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
