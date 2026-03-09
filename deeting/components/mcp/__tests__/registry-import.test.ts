import { parseMcpRegistryImportConfig } from "@/components/mcp/registry-import"

describe("registry import", () => {
  it("returns invalid when mcpServers is missing or empty", () => {
    expect(parseMcpRegistryImportConfig({})).toEqual({ kind: "invalid" })
    expect(parseMcpRegistryImportConfig({ mcpServers: {} })).toEqual({ kind: "invalid" })
  })

  it("builds sse and stdio server create requests", () => {
    expect(parseMcpRegistryImportConfig({
      mcpServers: {
        remoteA: { url: "https://example.com/sse", name: "Remote A" },
        localB: {
          command: "node",
          args: ["server.js", 42, "--watch"],
          env: { API_KEY: "secret", DEBUG: true },
        },
      },
    })).toEqual({
      kind: "ok",
      requests: [
        {
          name: "Remote A",
          server_type: "sse",
          sse_url: "https://example.com/sse",
          auth_type: "none",
          is_enabled: true,
        },
        {
          name: "localB",
          server_type: "stdio",
          is_enabled: false,
          draft_config: {
            command: "node",
            args: ["server.js", "--watch"],
            env: { API_KEY: "", DEBUG: "" },
          },
        },
      ],
    })
  })

  it("ignores invalid entries but still returns valid requests", () => {
    expect(parseMcpRegistryImportConfig({
      mcpServers: {
        broken: { foo: "bar" },
        remoteA: { sse_url: "https://example.com/stream" },
      },
    })).toEqual({
      kind: "ok",
      requests: [
        {
          name: "remoteA",
          server_type: "sse",
          sse_url: "https://example.com/stream",
          auth_type: "none",
          is_enabled: true,
        },
      ],
    })
  })
})