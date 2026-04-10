import {
  clearConversation,
  deleteConversationMessage,
  fetchConversationHistory,
  fetchConversationSessions,
  fetchConversationWindow,
} from "@/lib/api/conversations"
import { request } from "@/lib/http"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@/lib/http", () => ({
  request: jest.fn(),
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

describe("conversation tauri apis", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("fetches conversation window via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      session_id: "session-local-1",
      messages: [{ role: "user", content: "hi", turn_index: 1 }],
      meta: { message_count: 1, status: "active" },
      summary: { version: 1, summary_text: "summary" },
    } as unknown)

    const result = await fetchConversationWindow("session-local-1")

    expect(result).toEqual({
      session_id: "session-local-1",
      messages: [{ role: "user", content: "hi", turn_index: 1 }],
      meta: { message_count: 1, status: "active" },
      summary: { version: 1, summary_text: "summary" },
    })
    expect(mockInvoke).toHaveBeenCalledWith("get_local_conversation_window", {
      sessionId: "session-local-1",
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("falls back to local history command when window command fails", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockRejectedValueOnce(new Error("window command unavailable"))
      .mockResolvedValueOnce({
        session_id: "session-local-2",
        messages: [{ role: "assistant", content: "reply", turn_index: 2 }],
        next_cursor: null,
        has_more: false,
      } as unknown)

    const result = await fetchConversationWindow("session-local-2")

    expect(result).toEqual({
      session_id: "session-local-2",
      messages: [{ role: "assistant", content: "reply", turn_index: 2 }],
      meta: null,
      summary: null,
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "get_local_conversation_window", {
      sessionId: "session-local-2",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "list_local_conversation_history", {
      query: { session_id: "session-local-2", limit: 200 },
    })
  })

  it("fetches conversation sessions via tauri command with summary text", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValue({
      items: [
        {
          session_id: "session-local-3",
          title: "title",
          summary_text: "summary text",
          message_count: 3,
          first_message_at: "2026-03-03T00:00:00Z",
          last_active_at: "2026-03-03T00:01:00Z",
        },
      ],
      next_page: null,
      previous_page: null,
    } as unknown)

    const result = await fetchConversationSessions({ size: 10, status: "active" })

    expect(result.items[0]?.summary_text).toBe("summary text")
    expect(mockInvoke).toHaveBeenCalledWith("list_local_conversations", {
      query: {
        cursor: null,
        size: 10,
        assistant_id: null,
        status: "active",
      },
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("does not synthesize pending approval assistant turns into first-page local history", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce({
        session_id: "session-local-history-1",
        messages: [{ role: "user", content: "查一下资料", turn_index: 1 }],
        next_cursor: null,
        has_more: false,
      } as unknown)

    const result = await fetchConversationHistory("session-local-history-1")

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toMatchObject({
      role: "user",
      turn_index: 1,
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "list_local_conversation_history", {
      query: { session_id: "session-local-history-1", cursor: null, limit: null },
    })
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it("does not query pending approvals separately when history already contains the same tool call", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce({
        session_id: "session-local-history-2",
        messages: [
          { role: "user", content: "查一下资料", turn_index: 1 },
          {
            role: "assistant",
            content: "",
            turn_index: 2,
            meta_info: {
              blocks: [
                {
                  type: "tool_result",
                  callId: "call-existing",
                  toolName: "tavily_search",
                  status: "requires_approval",
                  result: {
                    status: "REQUIRES_APPROVAL",
                    approval_token: "approval-existing",
                  },
                },
              ],
            },
          },
        ],
        next_cursor: null,
        has_more: false,
      } as unknown)

    const result = await fetchConversationHistory("session-local-history-2")

    expect(result.messages).toHaveLength(2)
    expect(result.messages[1]).toMatchObject({
      role: "assistant",
      turn_index: 2,
    })
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it("reconciles execution lifecycle history blocks against the latest persisted execution tree", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce({
        session_id: "session-local-history-exec",
        messages: [
          {
            role: "assistant",
            content: "",
            turn_index: 1,
            meta_info: {
              execution_tree: {
                schema_version: 1,
                root_execution_id: "exec-root-history",
                execution_id: "exec-root-history",
                execution_status: "running",
              },
              blocks: [
                {
                  type: "ui",
                  viewType: "execution.lifecycle",
                  payload: {
                    schema_version: 1,
                    root_execution_id: "exec-root-history",
                    execution_id: "exec-root-history",
                    execution_status: "running",
                  },
                },
              ],
            },
          },
        ],
        next_cursor: null,
        has_more: false,
      } as unknown)
      .mockResolvedValueOnce({
        root: {
          root_execution_id: "exec-root-history",
          session_id: "session-local-history-exec",
          message_id: "msg-1",
          turn_index: 1,
          schema_version: 1,
          execution_id: "exec-root-history",
          execution_kind: "workflow",
          execution_status: "integrated",
          terminal_status: "succeeded",
          target_id: null,
          target_name: "Persisted Worker",
          target_invocation_kind: "chat",
          target_worker_ref: null,
          target_workflow_run_id: "run-persisted",
          selection: null,
          available_actions: [{ kind: "open" }],
          summary: "Hydrated from persistence",
          error: null,
          result_payload: null,
          raw_json: {
            delegated_result: {
              type: "delegated_result",
              schema_version: 1,
              kind: "workflow",
              authoritative: true,
              status: "succeeded",
              execution_id: "exec-root-history",
              target: {
                name: "Persisted Worker",
                invocation_kind: "chat",
                workflow_run_id: "run-persisted",
              },
              available_actions: [{ kind: "open" }],
              summary: "Hydrated from persistence",
              steps: [],
              primary_output: null,
              error: null,
            },
          },
          started_at_ms: null,
          completed_at_ms: null,
          created_at: "2026-03-30T00:00:00Z",
          updated_at: "2026-03-30T00:00:01Z",
        },
        children: [],
      } as unknown)

    const result = await fetchConversationHistory("session-local-history-exec", {
      includePendingApprovals: false,
    })

    expect(result.messages[0]).toMatchObject({
      meta_info: {
        execution_tree: expect.objectContaining({
          root_execution_id: "exec-root-history",
          execution_status: "integrated",
          persisted_snapshot: true,
          delegated_result: expect.objectContaining({
            type: "delegated_result",
            kind: "workflow",
            authoritative: true,
          }),
          target: expect.objectContaining({
            name: "Persisted Worker",
            workflow_run_id: "run-persisted",
          }),
        }),
        blocks: [
          expect.objectContaining({
            type: "ui",
            viewType: "execution.lifecycle",
            payload: expect.objectContaining({
              execution_status: "integrated",
              persisted_snapshot: true,
            }),
          }),
        ],
      },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "list_local_conversation_history", {
      query: { session_id: "session-local-history-exec", cursor: null, limit: null },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_local_conversation_execution_tree", {
      rootExecutionId: "exec-root-history",
    })
  })

  it("requires tauri runtime for conversation sessions", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    await expect(fetchConversationSessions({ size: 5 })).rejects.toThrow(
      "Conversation APIs are only available in Tauri runtime"
    )
    expect(mockRequest).not.toHaveBeenCalled()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("clears desktop object storage assets before clearing a local conversation", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce({
        session_id: "session-local-4",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "https://cdn.example.com/assets/chat/demo.png" },
              },
            ],
            turn_index: 1,
          },
        ],
        next_cursor: null,
        has_more: false,
      } as unknown)
      .mockResolvedValueOnce({
        id: "11111111-1111-4111-8111-111111111111",
        user_id: "00000000-0000-0000-0000-000000000000",
        provider: "cloudflare_r2_s3",
        bucket: "demo-bucket",
        region: "auto",
        endpoint: "https://example.r2.cloudflarestorage.com",
        public_base_url: "https://cdn.example.com/assets",
        path_prefix: "desktop/uploads",
        is_path_style: false,
        access_key_id: "AKIA-DEMO",
        has_secret: true,
        is_enabled: true,
        created_at: "2026-03-10T00:00:00Z",
        updated_at: "2026-03-10T00:00:01Z",
      } as unknown)
      .mockResolvedValueOnce(true as unknown)
      .mockResolvedValueOnce({
        session_id: "session-local-4",
        cleared: true,
      } as unknown)

    const result = await clearConversation("session-local-4")

    expect(result.cleared).toBe(true)
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "list_local_conversation_history", {
      query: { session_id: "session-local-4", cursor: null, limit: 500 },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_local_desktop_object_storage_config", undefined)
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "delete_local_desktop_object_storage_object", {
      object_key: "chat/demo.png",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(4, "clear_local_conversation", {
      sessionId: "session-local-4",
    })
  })

  it("prefers objectKey when clearing local conversation assets", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce({
        session_id: "session-local-4b",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "asset://desktop/uploads/chat/by-key.png" },
              },
            ],
            turn_index: 1,
          },
        ],
        next_cursor: null,
        has_more: false,
      } as unknown)
      .mockResolvedValueOnce(null as unknown)
      .mockResolvedValueOnce(true as unknown)
      .mockResolvedValueOnce({
        session_id: "session-local-4b",
        cleared: true,
      } as unknown)

    const result = await clearConversation("session-local-4b")

    expect(result.cleared).toBe(true)
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "list_local_conversation_history", {
      query: { session_id: "session-local-4b", cursor: null, limit: 500 },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_local_desktop_object_storage_config", undefined)
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "delete_local_desktop_object_storage_object", {
      object_key: "desktop/uploads/chat/by-key.png",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(4, "clear_local_conversation", {
      sessionId: "session-local-4b",
    })
  })

  it("cleans desktop object storage assets before deleting a local conversation message", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce({
        session_id: "session-local-5",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "https://cdn.example.com/assets/chat/one.png" },
              },
            ],
            turn_index: 2,
          },
        ],
        next_cursor: null,
        has_more: false,
      } as unknown)
      .mockResolvedValueOnce({
        id: "11111111-1111-4111-8111-111111111111",
        user_id: "00000000-0000-0000-0000-000000000000",
        provider: "cloudflare_r2_s3",
        bucket: "demo-bucket",
        region: "auto",
        endpoint: "https://example.r2.cloudflarestorage.com",
        public_base_url: "https://cdn.example.com/assets",
        path_prefix: "desktop/uploads",
        is_path_style: false,
        access_key_id: "AKIA-DEMO",
        has_secret: true,
        is_enabled: true,
        created_at: "2026-03-10T00:00:00Z",
        updated_at: "2026-03-10T00:00:01Z",
      } as unknown)
      .mockResolvedValueOnce(true as unknown)
      .mockResolvedValueOnce({
        session_id: "session-local-5",
        turn_index: 2,
        deleted: true,
      } as unknown)

    const result = await deleteConversationMessage("session-local-5", 2)

    expect(result.deleted).toBe(true)
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "list_local_conversation_history", {
      query: { session_id: "session-local-5", cursor: null, limit: 500 },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_local_desktop_object_storage_config", undefined)
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "delete_local_desktop_object_storage_object", {
      object_key: "chat/one.png",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(4, "delete_local_conversation_message", {
      sessionId: "session-local-5",
      turnIndex: 2,
    })
  })

  it("keeps url-to-objectKey cleanup compatibility when deleting a message", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce({
        session_id: "session-local-5b",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "https://cdn.example.com/assets/chat/legacy.png" },
              },
            ],
            turn_index: 2,
          },
        ],
        next_cursor: null,
        has_more: false,
      } as unknown)
      .mockResolvedValueOnce({
        id: "11111111-1111-4111-8111-111111111111",
        user_id: "00000000-0000-0000-0000-000000000000",
        provider: "cloudflare_r2_s3",
        bucket: "demo-bucket",
        region: "auto",
        endpoint: "https://example.r2.cloudflarestorage.com",
        public_base_url: "https://cdn.example.com/assets",
        path_prefix: "desktop/uploads",
        is_path_style: false,
        access_key_id: "AKIA-DEMO",
        has_secret: true,
        is_enabled: true,
        created_at: "2026-03-10T00:00:00Z",
        updated_at: "2026-03-10T00:00:01Z",
      } as unknown)
      .mockResolvedValueOnce(true as unknown)
      .mockResolvedValueOnce({
        session_id: "session-local-5b",
        turn_index: 2,
        deleted: true,
      } as unknown)

    const result = await deleteConversationMessage("session-local-5b", 2)

    expect(result.deleted).toBe(true)
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "delete_local_desktop_object_storage_object", {
      object_key: "chat/legacy.png",
    })
  })
})
