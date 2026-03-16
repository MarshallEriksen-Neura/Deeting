import {
  createAssistant,
  deleteAssistant,
  updateAssistant,
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

const assistantId = "ca8c65e1-ffdd-45aa-8f58-b7709ed318de"
const versionId = "3c1855f8-4080-4f67-8bdf-d00adaf42cae"

describe("assistant crud api", () => {
  afterEach(() => {
    mockRequest.mockReset()
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("creates assistant via cloud request in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockRequest.mockResolvedValueOnce({
      id: assistantId,
      owner_user_id: null,
      visibility: "private",
      status: "draft",
      share_slug: null,
      summary: "summary",
      icon_id: "lucide:bot",
      current_version_id: versionId,
      published_at: null,
      versions: [
        {
          id: versionId,
          version: "1.0.0",
          name: "assistant-v1",
          description: "desc",
          system_prompt: "you are assistant",
          tags: ["#chat"],
        },
      ],
      install_count: 0,
      rating_avg: 0,
      rating_count: 0,
    })

    const result = await createAssistant({
      visibility: "private",
      status: "draft",
      summary: "summary",
      icon_id: "lucide:bot",
      version: {
        name: "assistant-v1",
        description: "desc",
        system_prompt: "you are assistant",
        model_config: {
          model: "gpt-4o-mini",
          provider_model_id: "22222222-2222-4222-8222-222222222222",
        },
        tags: ["#chat"],
      },
    })

    expect(result.id).toBe(assistantId)
    expect(mockRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: "/api/v1/assistants",
        method: "POST",
        data: expect.objectContaining({
          version: expect.objectContaining({
            name: "assistant-v1",
            system_prompt: "you are assistant",
            model_config: {
              model: "gpt-4o-mini",
              provider_model_id: "22222222-2222-4222-8222-222222222222",
            },
            tags: ["#chat"],
          }),
        }),
      })
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("updates assistant via cloud request in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockRequest.mockResolvedValueOnce({
        id: assistantId,
        owner_user_id: null,
        visibility: "private",
        status: "published",
        share_slug: null,
        summary: "new-summary",
        icon_id: "lucide:brain",
        current_version_id: versionId,
        published_at: null,
        versions: [
          {
            id: versionId,
            version: "1.0.1",
            name: "assistant-v1",
            description: "new-desc",
            system_prompt: "new prompt",
            tags: ["#chat"],
          },
        ],
        install_count: 0,
        rating_avg: 0,
        rating_count: 0,
      } as unknown)

    const result = await updateAssistant(assistantId, {
      summary: "new-summary",
      icon_id: "lucide:brain",
      version: {
        name: "assistant-v1",
        description: "new-desc",
        system_prompt: "new prompt",
        model_config: {
          model: "gpt-4.1",
          provider_model_id: "33333333-3333-4333-8333-333333333333",
        },
      },
    })

    expect(result.id).toBe(assistantId)
    expect(mockRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: `/api/v1/assistants/${assistantId}`,
        method: "PATCH",
        data: expect.objectContaining({
          summary: "new-summary",
          icon_id: "lucide:brain",
          version: expect.objectContaining({
            name: "assistant-v1",
            system_prompt: "new prompt",
            model_config: {
              model: "gpt-4.1",
              provider_model_id: "33333333-3333-4333-8333-333333333333",
            },
          }),
        }),
      })
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("deletes assistant via cloud request in tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockRequest.mockResolvedValueOnce({} as unknown)

    await deleteAssistant(assistantId)

    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `/api/v1/assistants/${assistantId}`,
        method: "DELETE",
      })
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("falls back to web crud outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    mockRequest
      .mockResolvedValueOnce({
        id: assistantId,
        owner_user_id: null,
        visibility: "private",
        status: "draft",
        share_slug: null,
        summary: "summary",
        icon_id: "lucide:bot",
        current_version_id: versionId,
        published_at: null,
        versions: [
          {
            id: versionId,
            version: "1.0.0",
            name: "assistant-v1",
            description: "desc",
            system_prompt: "you are assistant",
            tags: ["#chat"],
          },
        ],
        install_count: 0,
        rating_avg: 0,
        rating_count: 0,
      })
      .mockResolvedValueOnce({
        id: assistantId,
        owner_user_id: null,
        visibility: "private",
        status: "published",
        share_slug: null,
        summary: "summary2",
        icon_id: "lucide:bot",
        current_version_id: versionId,
        published_at: null,
        versions: [
          {
            id: versionId,
            version: "1.0.1",
            name: "assistant-v2",
            description: "desc2",
            system_prompt: "prompt2",
            tags: ["#chat"],
          },
        ],
        install_count: 1,
        rating_avg: 4,
        rating_count: 1,
      })
      .mockResolvedValueOnce({})

    await createAssistant({
      visibility: "private",
      status: "draft",
      version: {
        name: "assistant-v1",
        system_prompt: "you are assistant",
      },
    })
    await updateAssistant(assistantId, {
      summary: "summary2",
      version: {
        name: "assistant-v2",
        system_prompt: "prompt2",
      },
    })
    await deleteAssistant(assistantId)

    expect(mockRequest).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: "/api/v1/assistants",
        method: "POST",
      })
    )
    expect(mockRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: `/api/v1/assistants/${assistantId}`,
        method: "PATCH",
      })
    )
    expect(mockRequest).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        url: `/api/v1/assistants/${assistantId}`,
        method: "DELETE",
      })
    )
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
