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

  it("fetches assistant installs via web request even in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockRequest.mockResolvedValue({
      items: [installItem],
      next_page: null,
      previous_page: null,
    })

    const result = await fetchAssistantInstalls({ size: 20 })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].assistant_id).toBe(installItem.assistant_id)
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/assistants/installs",
        method: "GET",
        params: { size: 20 },
      })
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("allows assistant install in tauri runtime via cloud request", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockRequest.mockResolvedValue({})

    await installAssistant(installItem.assistant_id, {
      follow_latest: true,
    })

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `/api/v1/assistants/${installItem.assistant_id}/install`,
        method: "POST",
        data: { follow_latest: true },
      })
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("allows assistant install updates in tauri runtime via cloud request", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockRequest.mockResolvedValue({})

    await updateAssistantInstall(installItem.assistant_id, {
      alias: "my-alias",
      follow_latest: false,
      pinned_version_id: "3c1855f8-4080-4f67-8bdf-d00adaf42cae",
    })

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `/api/v1/assistants/${installItem.assistant_id}/install`,
        method: "PATCH",
        data: {
          alias: "my-alias",
          follow_latest: false,
          pinned_version_id: "3c1855f8-4080-4f67-8bdf-d00adaf42cae",
        },
      })
    )
    expect(mockInvoke).not.toHaveBeenCalled()
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
