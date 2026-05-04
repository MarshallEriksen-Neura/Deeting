import type { IslandSelectionContext } from "./selection-context-types"
import { buildSelectionActionPrompt } from "./selection-action-prompts"

const selection: IslandSelectionContext = {
  selectionId: "selection-1",
  text: "Hello world",
  preview: "Hello world",
  source: "accessibility",
  capturedAt: 1,
  charCount: 11,
  truncated: false,
  activeAction: null,
}

describe("buildSelectionActionPrompt", () => {
  it("builds translate prompts with explicit language direction", () => {
    expect(
      buildSelectionActionPrompt("translate", selection, {
        translateSource: "English",
        translateTarget: "Chinese",
      }),
    ).toContain("Translate the selected text from English into Chinese.")
  })

  it("includes ask question exactly once", () => {
    const prompt = buildSelectionActionPrompt("ask", selection, {
      question: "What does this mean?",
    })

    expect(prompt.match(/What does this mean\?/g)).toHaveLength(1)
    expect(prompt).toContain("[Selected Text]\nHello world")
  })
})
