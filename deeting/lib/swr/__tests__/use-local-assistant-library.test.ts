import { fetchLocalAssistantLibrary } from "@/lib/swr/use-local-assistant-library"
import {
  listLocalAssistantEntities,
  listLocalAssistantInstallations,
  listLocalAssistants,
  listLocalAssistantVersions,
} from "@/lib/api/assistants"

jest.mock("@/lib/api/assistants", () => ({
  listLocalAssistants: jest.fn(),
  listLocalAssistantEntities: jest.fn(),
  listLocalAssistantVersions: jest.fn(),
  listLocalAssistantInstallations: jest.fn(),
}))

const mockListLocalAssistants = listLocalAssistants as jest.MockedFunction<
  typeof listLocalAssistants
>
const mockListLocalAssistantEntities = listLocalAssistantEntities as jest.MockedFunction<
  typeof listLocalAssistantEntities
>
const mockListLocalAssistantVersions = listLocalAssistantVersions as jest.MockedFunction<
  typeof listLocalAssistantVersions
>
const mockListLocalAssistantInstallations =
  listLocalAssistantInstallations as jest.MockedFunction<
    typeof listLocalAssistantInstallations
  >

const assistantId = "ca8c65e1-ffdd-45aa-8f58-b7709ed318de"
const versionId = "3c1855f8-4080-4f67-8bdf-d00adaf42cae"
const installId = "3f04afba-f056-4329-b869-6e0f133f9839"

describe("fetchLocalAssistantLibrary", () => {
  afterEach(() => {
    mockListLocalAssistants.mockReset()
    mockListLocalAssistantEntities.mockReset()
    mockListLocalAssistantVersions.mockReset()
    mockListLocalAssistantInstallations.mockReset()
  })

  it("combines assistant rows with entity, version, and install metadata", async () => {
    mockListLocalAssistants.mockResolvedValue([
      {
        id: assistantId,
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
        updated_at: "2026-03-16T01:00:00Z",
      },
    ])
    mockListLocalAssistantEntities.mockResolvedValue([
      {
        id: assistantId,
        owner_user_id: null,
        visibility: "private",
        status: "published",
        share_slug: null,
        summary: "entity summary",
        icon_id: "lucide:brain",
        install_count: 1,
        rating_avg: 4.5,
        rating_count: 2,
        current_version_id: versionId,
        published_at: "2026-03-16T00:00:00Z",
        created_at: "2026-03-16T00:00:00Z",
        updated_at: "2026-03-16T01:00:00Z",
      },
    ])
    mockListLocalAssistantVersions.mockResolvedValue([
      {
        id: versionId,
        assistant_id: assistantId,
        version: "1.0.0",
        name: "assistant-v1",
        description: "version summary",
        system_prompt: "you are assistant",
        model_config: null,
        tags: ["#chat"],
        changelog: null,
        published_at: "2026-03-16T00:00:00Z",
        created_at: "2026-03-16T00:00:00Z",
        updated_at: "2026-03-16T01:00:00Z",
      },
    ])
    mockListLocalAssistantInstallations.mockResolvedValue({
      items: [
        {
          id: installId,
          assistant_id: assistantId,
          alias: null,
          icon_override: null,
          pinned_version_id: null,
          follow_latest: true,
          is_enabled: true,
          sort_order: 0,
          assistant: {
            assistant_id: assistantId,
            owner_user_id: null,
            icon_id: "lucide:brain",
            share_slug: null,
            summary: "entity summary",
            published_at: "2026-03-16T00:00:00Z",
            current_version_id: versionId,
            install_count: 1,
            rating_avg: 4.5,
            rating_count: 2,
            tags: ["#chat"],
            version: {
              id: versionId,
              version: "1.0.0",
              name: "assistant-v1",
              description: "version summary",
              system_prompt: "you are assistant",
              tags: ["#chat"],
              published_at: "2026-03-16T00:00:00Z",
            },
          },
        },
      ],
      next_page: null,
      previous_page: null,
    })

    const logger = { warn: jest.fn() }
    const result = await fetchLocalAssistantLibrary({ logger })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      assistant: { id: assistantId },
      entity: { current_version_id: versionId },
      version: { id: versionId, name: "assistant-v1" },
      installed: true,
    })
    expect(mockListLocalAssistantInstallations).toHaveBeenCalledWith({ size: 200 })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it("keeps assistant rows visible when install metadata fails", async () => {
    mockListLocalAssistants.mockResolvedValue([
      {
        id: assistantId,
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
        updated_at: "2026-03-16T01:00:00Z",
      },
    ])
    mockListLocalAssistantEntities.mockResolvedValue([])
    mockListLocalAssistantVersions.mockResolvedValue([])
    const installError = new Error("assistant version missing")
    mockListLocalAssistantInstallations.mockRejectedValue(installError)

    const logger = { warn: jest.fn() }
    const result = await fetchLocalAssistantLibrary({ logger })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      assistant: { id: assistantId, name: "assistant-v1" },
      installed: false,
    })
    expect(logger.warn).toHaveBeenCalledWith(
      "local_assistant_library_installs_load_failed",
      installError
    )
  })
})
