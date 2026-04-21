import {
  parseLeadingTaskAgentMention,
  resolveLeadingTaskAgentMention,
} from "./task-agent-mention"

describe("parseLeadingTaskAgentMention", () => {
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
})
