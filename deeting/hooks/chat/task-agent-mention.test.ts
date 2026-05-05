import {
  buildLeadingTaskAgentMentionInput,
  getLeadingTaskAgentMentionDraft,
  getLeadingTaskAgentMentionQuery,
  parseLeadingTaskAgentMention,
  resolveLeadingTaskAgentMention,
} from "./task-agent-mention"

describe("parseLeadingTaskAgentMention", () => {
  it("builds a draft for the composer picker when only the trigger is present", () => {
    expect(getLeadingTaskAgentMentionDraft("@")).toEqual({
      query: "",
      prompt: "",
    })
  })

  it("builds a draft query and keeps the prompt suffix for picker insertion", () => {
    expect(getLeadingTaskAgentMentionDraft("@达 画一只猫")).toEqual({
      query: "达",
      prompt: "画一只猫",
    })
  })

  it("keeps the full raw query for picker filtering before selection", () => {
    expect(getLeadingTaskAgentMentionQuery("@Image A")).toBe("Image A")
  })

  it("builds mention input while preserving the prompt suffix", () => {
    expect(buildLeadingTaskAgentMentionInput("达芬奇", "画一只猫")).toBe(
      "@达芬奇 画一只猫",
    )
  })

  it("parses a leading task-agent mention and remaining prompt", () => {
    expect(parseLeadingTaskAgentMention("@达芬奇 画一只猫")).toEqual({
      agentName: "达芬奇",
      prompt: "画一只猫",
    })
  })

  it("returns empty prompt when only a mention is present", () => {
    expect(parseLeadingTaskAgentMention("@达芬奇")).toEqual({
      agentName: "达芬奇",
      prompt: "",
    })
  })

  it("ignores text without a leading mention", () => {
    expect(parseLeadingTaskAgentMention("叫达芬奇画一只猫")).toBeNull()
  })

  it("resolves a mention against local task agents", () => {
    expect(
      resolveLeadingTaskAgentMention("@达芬奇 画一只猫", [
        { id: "agent-1", name: "达芬奇" },
        { id: "agent-2", name: "米开朗基罗" },
      ]),
    ).toEqual({
      mention: {
        agentName: "达芬奇",
        prompt: "画一只猫",
      },
      agent: {
        id: "agent-1",
        name: "达芬奇",
      },
    })
  })

  it("resolves a mention when the task-agent name contains spaces", () => {
    expect(
      resolveLeadingTaskAgentMention("@Image Agent 画一只长翅膀的猫", [
        { id: "agent-1", name: "Image Agent" },
        { id: "agent-2", name: "Image" },
      ]),
    ).toEqual({
      mention: {
        agentName: "Image Agent",
        prompt: "画一只长翅膀的猫",
      },
      agent: {
        id: "agent-1",
        name: "Image Agent",
      },
    })
  })
})
