import {
  normalizeProviderEndpointInput,
  stripRedundantVersionPrefix,
} from "./endpoint-normalization"

describe("normalizeProviderEndpointInput", () => {
  it("keeps openai root host and fills chat/completions", () => {
    expect(
      normalizeProviderEndpointInput({
        baseUrl: "https://api.openai.com",
        protocol: "openai",
      })
    ).toEqual({
      baseUrl: "https://api.openai.com",
      chatTransportPath: "chat/completions",
      hadExplicitChatPath: false,
      protocolHint: "openai",
    })
  })

  it("splits full openai chat endpoint into base and path", () => {
    expect(
      normalizeProviderEndpointInput({
        baseUrl: "https://api.openai.com/v1/chat/completions",
        protocol: "openai",
      })
    ).toEqual({
      baseUrl: "https://api.openai.com/v1",
      chatTransportPath: "chat/completions",
      hadExplicitChatPath: true,
      protocolHint: "openai",
    })
  })

  it("keeps versioned ark base without forcing /v1", () => {
    expect(
      normalizeProviderEndpointInput({
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        protocol: "openai",
      })
    ).toEqual({
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      chatTransportPath: "chat/completions",
      hadExplicitChatPath: false,
      protocolHint: "openai",
    })
  })

  it("splits full anthropic messages endpoint into base and path", () => {
    expect(
      normalizeProviderEndpointInput({
        baseUrl: "https://api.anthropic.com/v1/messages",
        protocol: "anthropic",
      })
    ).toEqual({
      baseUrl: "https://api.anthropic.com",
      chatTransportPath: "v1/messages",
      hadExplicitChatPath: true,
      protocolHint: "anthropic",
    })
  })

  it("infers anthropic protocol from url when protocol is omitted", () => {
    expect(
      normalizeProviderEndpointInput({
        baseUrl: "https://api.anthropic.com",
      })
    ).toEqual({
      baseUrl: "https://api.anthropic.com",
      chatTransportPath: "v1/messages",
      hadExplicitChatPath: false,
      protocolHint: "anthropic",
    })
  })

  it("infers volcengine openspeech protocol from base url", () => {
    expect(
      normalizeProviderEndpointInput({
        baseUrl: "https://openspeech.bytedance.com",
      })
    ).toEqual({
      baseUrl: "https://openspeech.bytedance.com",
      chatTransportPath: null,
      hadExplicitChatPath: false,
      protocolHint: "volcengine_openspeech_tts",
    })
  })
})

describe("stripRedundantVersionPrefix", () => {
  it("strips v1 prefix", () => {
    expect(stripRedundantVersionPrefix("v1/chat/completions")).toBe("chat/completions")
  })

  it("strips api version prefix", () => {
    expect(stripRedundantVersionPrefix("api/v3/chat/completions")).toBe("chat/completions")
  })
})
