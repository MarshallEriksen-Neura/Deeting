import {
  hasVersionedPath,
  normalizeProviderEndpointInput,
  resolveOpenAICompatibleBaseUrl,
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

describe("hasVersionedPath", () => {
  it("detects plain version suffixes", () => {
    expect(hasVersionedPath("https://open.bigmodel.cn/api/paas/v4")).toBe(true)
  })

  it("detects api version segments", () => {
    expect(hasVersionedPath("https://ark.cn-beijing.volces.com/api/v3")).toBe(true)
  })

  it("returns false for unversioned roots", () => {
    expect(hasVersionedPath("https://api.openai.com")).toBe(false)
  })
})

describe("resolveOpenAICompatibleBaseUrl", () => {
  it("appends /v1 for unversioned openai-compatible bases", () => {
    expect(resolveOpenAICompatibleBaseUrl("https://api.openai.com", true)).toBe(
      "https://api.openai.com/v1"
    )
  })

  it("keeps existing version suffixes untouched", () => {
    expect(resolveOpenAICompatibleBaseUrl("https://open.bigmodel.cn/api/paas/v4", true)).toBe(
      "https://open.bigmodel.cn/api/paas/v4"
    )
  })
})
