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
  detectedLanguage: { code: "en", displayName: "English" },
}

const unknownSelection: IslandSelectionContext = {
  ...selection,
  text: "123 !!!",
  preview: "123 !!!",
  detectedLanguage: { code: "unknown", displayName: "Unknown" },
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

  it("uses detected language as default source when no override is given", () => {
    const chineseSelection: IslandSelectionContext = {
      ...selection,
      text: "你好",
      preview: "你好",
      detectedLanguage: { code: "zh", displayName: "Chinese" },
    }
    expect(
      buildSelectionActionPrompt("translate", chineseSelection, {
        translateTarget: "English",
      }),
    ).toContain("Translate the selected text from Chinese into English.")
  })

  it("falls back to auto-detected phrasing when detection is unknown", () => {
    expect(
      buildSelectionActionPrompt("translate", unknownSelection, {
        translateTarget: "Japanese",
      }),
    ).toContain(
      "Translate the selected text from auto-detected source language into Japanese.",
    )
  })

  it("explicit translateSource overrides detected language", () => {
    expect(
      buildSelectionActionPrompt("translate", selection, {
        translateSource: "Spanish",
        translateTarget: "Chinese",
      }),
    ).toContain("Translate the selected text from Spanish into Chinese.")
  })

  it("includes ask question exactly once", () => {
    const prompt = buildSelectionActionPrompt("ask", selection, {
      question: "What does this mean?",
    })

    expect(prompt.match(/What does this mean\?/g)).toHaveLength(1)
    expect(prompt).toContain("[Selected Text]\nHello world")
  })
})
