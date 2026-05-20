import { filterModelGroupsByCapability } from "@/hooks/use-chat-models"
import type { ModelGroup } from "@/lib/api/models"

describe("filterModelGroupsByCapability", () => {
  it("keeps image-generation models out of chat model groups", () => {
    const groups: ModelGroup[] = [
      {
        instance_id: "grok",
        instance_name: "GROK",
        provider: "custom",
        icon: null,
        models: [
          {
            id: "grok-imagine-image-lite",
            provider_model_id: "pm-image",
            capabilities: ["image_generation"],
          },
        ],
      },
      {
        instance_id: "chat",
        instance_name: "Chat",
        provider: "custom",
        icon: null,
        models: [
          {
            id: "grok-4.20-fast",
            provider_model_id: "pm-chat",
            capabilities: ["chat"],
          },
        ],
      },
    ]

    expect(filterModelGroupsByCapability(groups, "chat")).toEqual([
      {
        instance_id: "chat",
        instance_name: "Chat",
        provider: "custom",
        icon: null,
        models: [
          {
            id: "grok-4.20-fast",
            provider_model_id: "pm-chat",
            capabilities: ["chat"],
          },
        ],
      },
    ])
  })

  it("keeps models without explicit capability metadata for cloud compatibility", () => {
    const groups: ModelGroup[] = [
      {
        instance_id: "cloud",
        instance_name: "Cloud",
        provider: "openai",
        icon: null,
        models: [
          {
            id: "gpt-5.5",
            provider_model_id: "pm-cloud",
          },
        ],
      },
    ]

    expect(filterModelGroupsByCapability(groups, "chat")).toEqual(groups)
  })
})
