import { inferProviderProtocol, resolveProviderProtocol } from "@/lib/providers/protocol"

describe("provider protocol helpers", () => {
  it("infers anthropic providers from provider metadata", () => {
    expect(inferProviderProtocol("anthropic")).toBe("anthropic")
    expect(inferProviderProtocol("claude-official")).toBe("anthropic")
    expect(inferProviderProtocol("openai_tts")).toBe("openai_tts")
    expect(inferProviderProtocol("minimax_tts")).toBe("minimax_tts")
    expect(inferProviderProtocol("volcengine_openspeech_tts")).toBe("volcengine_openspeech_tts")
    expect(inferProviderProtocol("minimax")).toBe("minimax")
    expect(inferProviderProtocol("volcengine-tts")).toBe("volcengine")
  })

  it("preserves explicit protocol before falling back to provider identity", () => {
    expect(resolveProviderProtocol("anthropic", "openai")).toBe("anthropic")
    expect(resolveProviderProtocol(undefined, "anthropic", "claude-official")).toBe("anthropic")
    expect(resolveProviderProtocol(undefined, undefined, "openai")).toBe("openai")
    expect(resolveProviderProtocol(undefined, "openai_tts")).toBe("openai_tts")
    expect(resolveProviderProtocol(undefined, "minimax_tts")).toBe("minimax_tts")
    expect(resolveProviderProtocol(undefined, "volcengine_openspeech_tts")).toBe("volcengine_openspeech_tts")
    expect(resolveProviderProtocol(undefined, "minimax-voice")).toBe("minimax")
    expect(resolveProviderProtocol(undefined, "volcengine")).toBe("volcengine")
  })
})
