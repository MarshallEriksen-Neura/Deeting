import {
  getMcpRegistryConflictResolutionPayload,
  resolveMcpRegistryEnableSkill,
  resolveMcpRegistryRemoteToolToggle,
} from "@/components/mcp/registry-tool-actions"

describe("registry tool actions", () => {
  it("resolves remote tool toggle payloads", () => {
    expect(resolveMcpRegistryRemoteToolToggle({ name: "search", sourceId: "server-1" }, true)).toEqual({
      kind: "ok",
      payload: { serverId: "server-1", toolName: "search", enabled: true },
    })

    expect(resolveMcpRegistryRemoteToolToggle({ name: "search" }, false)).toEqual({
      kind: "missing_server",
    })
  })

  it("resolves local skill enable requirements and conflict payloads", () => {
    expect(resolveMcpRegistryEnableSkill({ backingSkillId: "skill-1" })).toEqual({
      kind: "ok",
      skillId: "skill-1",
    })

    expect(resolveMcpRegistryEnableSkill({})).toEqual({
      kind: "missing_skill_id",
    })

    expect(getMcpRegistryConflictResolutionPayload("tool-1", "update")).toEqual({
      tool_id: "tool-1",
      payload: { action: "update" },
    })
  })
})