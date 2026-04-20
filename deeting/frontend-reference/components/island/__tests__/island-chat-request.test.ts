import { resolveIslandChatRequestConfig } from "../island-chat-request"

describe("resolveIslandChatRequestConfig", () => {
  it("keeps desktop local model picks on pool routing while passing the preferred member", () => {
    const config = resolveIslandChatRequestConfig({
      configModel: "provider-model-local-2",
      isTauriRuntime: true,
      models: [
        {
          id: "qwen-max",
          provider_model_id: "provider-model-local-1",
          request_route: "local_invoke",
          runtime_source: "desktop_local",
        },
        {
          id: "qwen-max",
          provider_model_id: "provider-model-local-2",
          request_route: "local_invoke",
          runtime_source: "desktop_local",
        },
      ],
    })

    expect(config).toEqual({
      model: "qwen-max",
      model_selection_mode: "pool",
      provider_model_id: "provider-model-local-2",
      useDesktopLocalGateway: true,
    })
  })

  it("keeps cloud selections on provider_model_id without desktop local gateway", () => {
    const config = resolveIslandChatRequestConfig({
      configModel: "provider-model-cloud-1",
      isTauriRuntime: false,
      models: [
        {
          id: "gpt-4.1",
          provider_model_id: "provider-model-cloud-1",
          request_route: "cloud_http",
          runtime_source: "cloud_internal",
        },
      ],
    })

    expect(config).toEqual({
      model: "gpt-4.1",
      model_selection_mode: undefined,
      provider_model_id: "provider-model-cloud-1",
      useDesktopLocalGateway: false,
    })
  })
})
