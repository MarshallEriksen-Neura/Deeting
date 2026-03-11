import {
  fetchAssistantInstalls,
  installAssistant,
  uninstallAssistant,
  updateAssistantInstall,
} from "@/lib/api/assistants"
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

const installItem = {
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
      description: "version-desc",
      system_prompt: "you are assistant",
      tags: ["chat"],
      published_at: null,
    },
  },
}

describe("assistant install apis", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("fetches assistant installs via tauri command", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "sync_local_system_assets") {
        return {
          fetched_count: 1,
          assistant_fetched_count: 1,
          skill_fetched_count: 0,
          upserted_count: 1,
          hidden_count: 0,
          metadata_only_count: 0,
          executable_count: 1,
          archived_count: 0,
          skill_install_fetched_count: 0,
          skill_install_upserted_count: 0,
          skill_reinstalled_count: 0,
          skill_failed_count: 0,
          disabled_skill_count: 0,
          archived_assistant_count: 0,
        }
      }
      if (command === "list_local_assistant_entities") {
        return [
          {
            id: installItem.assistant_id,
            owner_user_id: null,
            visibility: "public",
            status: "published",
            share_slug: null,
            summary: installItem.assistant.summary,
            icon_id: installItem.assistant.icon_id,
            current_version_id: installItem.assistant.current_version_id,
            published_at: null,
            install_count: 1,
            rating_avg: 0,
            rating_count: 0,
          },
        ]
      }
      if (command === "list_local_assistant_versions") {
        return [
          {
            ...installItem.assistant.version,
            assistant_id: installItem.assistant_id,
          },
        ]
      }
      throw new Error(`Unexpected command: ${command}`)
    })

    const result = await fetchAssistantInstalls({ size: 20 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].assistant_id).toBe(installItem.assistant_id)
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it("disallows assistant install in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    await expect(
      installAssistant(installItem.assistant_id, {
        follow_latest: true,
      })
    ).rejects.toThrow("assistant install is cloud-only")
  })

  it("disallows assistant install updates in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    await expect(
      updateAssistantInstall(installItem.assistant_id, {
        alias: "my-alias",
        follow_latest: false,
        pinned_version_id: "3c1855f8-4080-4f67-8bdf-d00adaf42cae",
      })
    ).rejects.toThrow("assistant install update is cloud-only")
  })

  it("falls back to web request outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest.mockResolvedValue({
      items: [installItem],
      next_page: null,
      previous_page: null,
    })

    await fetchAssistantInstalls({ size: 10 })
    await installAssistant(installItem.assistant_id)
    await updateAssistantInstall(installItem.assistant_id, { alias: "web" })
    await uninstallAssistant(installItem.assistant_id)

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(mockRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: "/api/v1/assistants/installs",
        method: "GET",
        params: { size: 10 },
      })
    )
    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: `/api/v1/assistants/${installItem.assistant_id}/install`,
        method: "POST",
      })
    )
    expect(mockRequest).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        url: `/api/v1/assistants/${installItem.assistant_id}/install`,
        method: "PATCH",
        data: { alias: "web" },
      })
    )
    expect(mockRequest).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        url: `/api/v1/assistants/${installItem.assistant_id}/install`,
        method: "DELETE",
      })
    )
  })
})
