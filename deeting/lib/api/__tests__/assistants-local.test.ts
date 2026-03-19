import {
  createLocalAssistant,
  installLocalAssistant,
  listLocalAssistantInstallations,
  listLocalAssistants,
  listLocalAssistantTags,
  updateLocalAssistant,
} from "@/lib/api/assistants"
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

describe("local assistant api", () => {
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

  it("lists local assistants via tauri command", async () => {
    mockInvoke.mockResolvedValue([
      {
        id: "00000000-0000-0000-0000-000000000001",
        name: "assistant-v1",
        description: "summary",
        avatar: "lucide:bot",
        system_prompt: "you are assistant",
        model_config: null,
        tags: ["#chat"],
        visibility: "private",
        source: "local",
        cloud_id: null,
        is_deleted: false,
        created_at: "2026-03-16T00:00:00Z",
        updated_at: "2026-03-16T00:00:00Z",
      },
    ] as unknown)

    const result = await listLocalAssistants()

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("00000000-0000-0000-0000-000000000001")
    expect(result[0].source).toBe("local")
    expect(mockInvoke).toHaveBeenCalledWith("list_local_assistants", undefined)
  })

  it("treats desktop env flag as tauri runtime even before window markers are available", async () => {
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
    mockInvoke.mockResolvedValue([] as unknown)

    const result = await listLocalAssistants()

    expect(result).toEqual([])
    expect(mockInvoke).toHaveBeenCalledWith("list_local_assistants", undefined)
  })

  it("lists local assistant tags via tauri command", async () => {
    mockInvoke.mockResolvedValue([
      {
        id: "3c1855f8-4080-4f67-8bdf-d00adaf42cae",
        name: "#chat",
        created_at: "2026-03-16T00:00:00Z",
        updated_at: "2026-03-16T00:00:00Z",
      },
    ] as unknown)

    const result = await listLocalAssistantTags()

    expect(result[0].name).toBe("#chat")
    expect(mockInvoke).toHaveBeenCalledWith("list_local_assistant_tags", undefined)
  })

  it("creates and updates a local assistant via tauri commands", async () => {
    mockInvoke
      .mockResolvedValueOnce("ca8c65e1-ffdd-45aa-8f58-b7709ed318de" as unknown)
      .mockResolvedValueOnce({
        id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
        name: "assistant-v2",
        description: "updated",
        avatar: "lucide:brain",
        system_prompt: "new prompt",
        model_config: null,
        tags: ["#python"],
        visibility: "private",
        source: "local",
        cloud_id: null,
        is_deleted: false,
        created_at: "2026-03-16T00:00:00Z",
        updated_at: "2026-03-16T01:00:00Z",
      } as unknown)

    const createdId = await createLocalAssistant({
      name: "assistant-v1",
      description: "summary",
      avatar: "lucide:bot",
      system_prompt: "you are assistant",
      tags: ["#chat"],
      visibility: "private",
    })
    const updated = await updateLocalAssistant(createdId, {
      name: "assistant-v2",
      description: "updated",
      avatar: "lucide:brain",
      system_prompt: "new prompt",
      tags: ["#python"],
      visibility: "private",
    })

    expect(createdId).toBe("ca8c65e1-ffdd-45aa-8f58-b7709ed318de")
    expect(updated.name).toBe("assistant-v2")
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "create_local_assistant", {
      payload: {
        name: "assistant-v1",
        description: "summary",
        avatar: "lucide:bot",
        system_prompt: "you are assistant",
        tags: ["#chat"],
        visibility: "private",
      },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "update_local_assistant", {
      id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
      payload: {
        name: "assistant-v2",
        description: "updated",
        avatar: "lucide:brain",
        system_prompt: "new prompt",
        tags: ["#python"],
        visibility: "private",
      },
    })
  })

  it("lists and installs local assistant installations via tauri commands", async () => {
    mockInvoke
      .mockResolvedValueOnce({
        items: [],
        next_page: null,
        previous_page: null,
      } as unknown)
      .mockResolvedValueOnce({
        id: "3f04afba-f056-4329-b869-6e0f133f9839",
        assistant_id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
        alias: null,
        icon_override: null,
        pinned_version_id: null,
        follow_latest: true,
        is_enabled: true,
        sort_order: 0,
        assistant: {
          assistant_id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
          owner_user_id: null,
          icon_id: "lucide:bot",
          share_slug: null,
          summary: "summary",
          published_at: null,
          current_version_id: "3c1855f8-4080-4f67-8bdf-d00adaf42cae",
          install_count: 1,
          rating_avg: 0,
          rating_count: 0,
          tags: ["chat"],
          version: {
            id: "3c1855f8-4080-4f67-8bdf-d00adaf42cae",
            version: "1.0.0",
            name: "assistant-v1",
            description: "summary",
            system_prompt: "you are assistant",
            tags: ["chat"],
            published_at: null,
          },
        },
      } as unknown)

    const page = await listLocalAssistantInstallations({ size: 20 })
    const installed = await installLocalAssistant("ca8c65e1-ffdd-45aa-8f58-b7709ed318de", {
      follow_latest: true,
    })

    expect(page.items).toHaveLength(0)
    expect(installed.assistant_id).toBe("ca8c65e1-ffdd-45aa-8f58-b7709ed318de")
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "list_local_assistant_installations", {
      query: { cursor: null, size: 20 },
    })
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "install_local_assistant", {
      assistant_id: "ca8c65e1-ffdd-45aa-8f58-b7709ed318de",
      payload: {
        follow_latest: true,
        pinned_version_id: null,
      },
    })
  })
})
