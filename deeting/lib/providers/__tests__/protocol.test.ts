import { inferProviderProtocol, resolveProviderProtocol } from "@/lib/providers/protocol"

describe("provider protocol helpers", () => {
  it("infers anthropic providers from provider metadata", () => {
    expect(inferProviderProtocol("anthropic")).toBe("anthropic")
    expect(inferProviderProtocol("claude-official")).toBe("anthropic")
  })

  it("preserves explicit protocol before falling back to provider identity", () => {
    expect(resolveProviderProtocol("anthropic", "openai")).toBe("anthropic")
    expect(resolveProviderProtocol(undefined, "anthropic", "claude-official")).toBe("anthropic")
    expect(resolveProviderProtocol(undefined, undefined, "openai")).toBe("openai")
  })
})