import {
  approveIslandTool,
  listIslandTextToSpeechAgents,
  rejectIslandTool,
  speakIslandText,
} from "@/lib/api/island"
import {
  listCustomTaskAgents,
  previewCustomTaskAgent,
} from "@/lib/api/custom-task-agents"
import { rejectDesktopTool, streamDesktopApproveTool } from "@/lib/api/mcp-desktop"

jest.mock("@/lib/api/chat", () => ({
  streamChatCompletion: jest.fn(),
  streamDesktopLocalChatCompletion: jest.fn(),
}))

jest.mock("@/lib/api/mcp-desktop", () => ({
  streamDesktopApproveTool: jest.fn(),
  rejectDesktopTool: jest.fn(),
}))

jest.mock("@/lib/api/custom-task-agents", () => ({
  listCustomTaskAgents: jest.fn(),
  previewCustomTaskAgent: jest.fn(),
}))

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

const mockApproveTool = streamDesktopApproveTool as jest.MockedFunction<
  typeof streamDesktopApproveTool
>
const mockRejectTool = rejectDesktopTool as jest.MockedFunction<typeof rejectDesktopTool>
const mockListCustomTaskAgents = listCustomTaskAgents as jest.MockedFunction<
  typeof listCustomTaskAgents
>
const mockPreviewCustomTaskAgent = previewCustomTaskAgent as jest.MockedFunction<
  typeof previewCustomTaskAgent
>

function makeAgent(overrides: Partial<Awaited<ReturnType<typeof listCustomTaskAgents>>[number]>) {
  return {
    id: "agent-1",
    name: "Voice Agent",
    description: null,
    task_prompt: "Speak the input.",
    invocation_kind: "text_to_speech" as const,
    preferred_for_image_generation: false,
    model_config: null,
    callable_mcp_tool_ids: [],
    guidance_skill_ids: [],
    callable_skill_action_refs: [],
    bound_asset_id: null,
    tags: [],
    discoverable: false,
    is_enabled: true,
    is_deleted: false,
    source_kind: null,
    source_path: null,
    source_repo: null,
    source_ref: null,
    source_hash: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("island approval api", () => {
  afterEach(() => {
    mockApproveTool.mockReset()
    mockRejectTool.mockReset()
    mockListCustomTaskAgents.mockReset()
    mockPreviewCustomTaskAgent.mockReset()
  })

  it("reuses the desktop local gateway approval flow for island approvals", async () => {
    mockApproveTool.mockResolvedValueOnce({
      status: "LOCAL_CHAT_RESUMED",
      continuation_blocks: [
        { type: "text", content: "Done." },
      ],
    } as unknown)

    const result = await approveIslandTool("approval-1", "search_notes", "call-1")

    expect(mockApproveTool).toHaveBeenCalledWith({
      approvalToken: "approval-1",
      approvalMode: "allow_once",
      callId: "call-1",
    })
    expect(result).toEqual({
      tool_name: "search_notes",
      approved: true,
      follow_up_texts: ["Done."],
    })
  })

  it("reuses the desktop local gateway rejection flow for island rejection", async () => {
    mockRejectTool.mockResolvedValueOnce({
      status: "LOCAL_CHAT_REJECTED",
    } as never)

    const result = await rejectIslandTool("approval-2", "search_notes")

    expect(mockRejectTool).toHaveBeenCalledWith({
      approvalToken: "approval-2",
      rejectMode: "reject_once",
    })
    expect(result).toEqual({
      tool_name: "search_notes",
      approved: false,
      follow_up_texts: [],
    })
  })

  it("lists only enabled text-to-speech agents for island voice selection", async () => {
    const voice = makeAgent({ id: "voice-1", name: "Narrator" })
    mockListCustomTaskAgents.mockResolvedValueOnce([
      voice,
      makeAgent({ id: "chat-1", invocation_kind: "chat" }),
      makeAgent({ id: "disabled-1", is_enabled: false }),
      makeAgent({ id: "deleted-1", is_deleted: true }),
    ])

    await expect(listIslandTextToSpeechAgents()).resolves.toEqual([voice])
  })

  it("uses the selected voice agent when speaking island translator output", async () => {
    mockListCustomTaskAgents.mockResolvedValueOnce([
      makeAgent({ id: "voice-a", name: "Default Voice", discoverable: true }),
      makeAgent({ id: "voice-b", name: "Chosen Voice" }),
    ])
    mockPreviewCustomTaskAgent.mockResolvedValueOnce({
      status: "completed",
      content: "",
      model_id: "tts-1",
      provider_model_id: "provider-1",
      invocation_kind: "text_to_speech",
      reasoning_content: null,
      tool_calls: [],
      tool_trace: [],
      callable_mcp_tool_ids: [],
      guidance_skill_ids: [],
      callable_skill_action_refs: [],
      images: [],
      audios: ["asset://audio-1.mp3"],
      raw: null,
    })

    const result = await speakIslandText({
      text: "hello",
      agentId: "voice-b",
    })

    expect(mockPreviewCustomTaskAgent).toHaveBeenCalledWith("voice-b", {
      message: "hello",
    })
    expect(result).toEqual({
      agentId: "voice-b",
      agentName: "Chosen Voice",
      payload: {
        source_url: "asset://audio-1.mp3",
        prompt_text: "hello",
      },
    })
  })

  it("falls back to the discoverable voice agent when no explicit selection exists", async () => {
    mockListCustomTaskAgents.mockResolvedValueOnce([
      makeAgent({ id: "voice-a", name: "Hidden Voice" }),
      makeAgent({ id: "voice-b", name: "Discoverable Voice", discoverable: true }),
    ])
    mockPreviewCustomTaskAgent.mockResolvedValueOnce({
      status: "completed",
      content: "",
      model_id: "tts-1",
      provider_model_id: "provider-1",
      invocation_kind: "text_to_speech",
      reasoning_content: null,
      tool_calls: [],
      tool_trace: [],
      callable_mcp_tool_ids: [],
      guidance_skill_ids: [],
      callable_skill_action_refs: [],
      images: [],
      audios: ["asset://audio-2.mp3"],
      raw: null,
    })

    await speakIslandText({ text: "hello" })

    expect(mockPreviewCustomTaskAgent).toHaveBeenCalledWith("voice-b", {
      message: "hello",
    })
  })
})
