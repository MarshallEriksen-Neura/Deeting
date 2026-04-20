import {
  getDesktopMcpRegistrySourceCreatePayload,
  getMcpRegistrySourceCreateRequest,
  getMcpRegistrySourceSyncPayload,
  shouldSyncCreatedMcpSource,
} from "@/components/mcp/registry-source-actions"

describe("registry source actions", () => {
  it("builds shared source create and sync payloads", () => {
    const input = {
      name: "Cloud Feed",
      sourceType: "cloud" as const,
      pathOrUrl: "https://example.com/feed",
      trustLevel: "official" as const,
      authToken: "secret",
    }

    expect(getMcpRegistrySourceCreateRequest(input)).toEqual({
      name: "Cloud Feed",
      source_type: "cloud",
      path_or_url: "https://example.com/feed",
      trust_level: "official",
    })

    expect(getMcpRegistrySourceSyncPayload(input.authToken)).toEqual({ auth_token: "secret" })
    expect(shouldSyncCreatedMcpSource(input)).toBe(true)
  })

  it("marks non-local desktop sources as read only and nulls missing tokens", () => {
    const input = {
      name: "Local Feed",
      sourceType: "local" as const,
      pathOrUrl: "/tmp/feed.json",
      trustLevel: "private" as const,
    }

    expect(getDesktopMcpRegistrySourceCreatePayload(input)).toEqual({
      name: "Local Feed",
      source_type: "local",
      path_or_url: "/tmp/feed.json",
      trust_level: "private",
      is_read_only: false,
    })

    expect(getMcpRegistrySourceSyncPayload()).toEqual({ auth_token: null })
    expect(shouldSyncCreatedMcpSource(input)).toBe(false)
  })
})