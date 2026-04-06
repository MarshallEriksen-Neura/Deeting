import {
  deleteCustomTaskAgent,
  getCustomTaskAgent,
  importClaudeAgents,
  previewCustomTaskAgent,
  previewClaudeAgentImport,
  updateCustomTaskAgent,
} from "@/lib/api/custom-task-agents"
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

const taskAgentProfile = {
  id: "agent-1",
  name: "Agent One",
  description: "profile summary",
  task_prompt: "Handle the task",
  invocation_kind: "chat" as const,
  preferred_for_image_generation: false,
  model_config: null,
  callable_mcp_tool_ids: [],
  guidance_skill_ids: [],
  callable_skill_action_refs: [],
  tags: ["ops"],
  discoverable: true,
  is_enabled: true,
  is_deleted: false,
  created_at: "2026-03-24T00:00:00Z",
  updated_at: "2026-03-24T00:00:00Z",
}

describe("custom task agent api", () => {
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

  it("uses camelCase top-level agentId args for tauri commands", async () => {
    mockInvoke
      .mockResolvedValueOnce(taskAgentProfile as unknown)
      .mockResolvedValueOnce(taskAgentProfile as unknown)
      .mockResolvedValueOnce(undefined as unknown)
      .mockResolvedValueOnce({
        status: "completed",
        content: "preview reply",
        model_id: "gpt-4.1",
        provider_model_id: "openai/gpt-4.1",
        invocation_kind: "chat",
        reasoning_content: null,
        tool_calls: [],
        tool_trace: [],
        callable_mcp_tool_ids: [],
        guidance_skill_ids: [],
        callable_skill_action_refs: [],
        images: [],
        audios: [],
        raw: null,
      } as unknown)

    await getCustomTaskAgent("agent-1")
    await updateCustomTaskAgent("agent-1", {
      name: "Agent One",
      task_prompt: "Handle the task",
    })
    await deleteCustomTaskAgent("agent-1")
    const preview = await previewCustomTaskAgent("agent-1", {
      message: "hello",
    })

    expect(preview.content).toBe("preview reply")
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "get_custom_task_agent", {
      agentId: "agent-1",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "update_custom_task_agent", {
      agentId: "agent-1",
      payload: {
        name: "Agent One",
        task_prompt: "Handle the task",
      },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "delete_custom_task_agent", {
      agentId: "agent-1",
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(4, "preview_custom_task_agent", {
      agentId: "agent-1",
      payload: {
        message: "hello",
        image_urls: [],
        temperature: null,
        max_tokens: null,
        max_rounds: null,
      },
    })
  })

  it("serializes uploaded markdown files for Claude import preview and import", async () => {
    mockInvoke
      .mockResolvedValueOnce({
        root_path: "uploaded-files",
        items: [],
      } as unknown)
      .mockResolvedValueOnce({
        root_path: "uploaded-files",
        created_count: 1,
        updated_count: 0,
        profiles: [taskAgentProfile],
      } as unknown)

    const file = new File(["---\nname: Planner\n---\n\nPlan work.\n"], "planner.md", {
      type: "text/markdown",
    })

    await previewClaudeAgentImport({ files: [file] })
    await importClaudeAgents({ files: [file] })

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "preview_claude_agent_import", {
      payload: {
        documents: [
          {
            filename: "planner.md",
            relative_path: "planner.md",
            content: "---\nname: Planner\n---\n\nPlan work.\n",
          },
        ],
      },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "import_claude_agents", {
      payload: {
        documents: [
          {
            filename: "planner.md",
            relative_path: "planner.md",
            content: "---\nname: Planner\n---\n\nPlan work.\n",
          },
        ],
      },
    })
  })
})
