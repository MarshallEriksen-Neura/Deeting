import type {
  IslandSelectionActionKind,
  IslandSelectionContext,
} from "./selection-context-types"

export interface SelectionActionPromptOptions {
  question?: string
  translateSource?: string
  translateTarget?: string
}

const ACTION_LABELS: Record<Exclude<IslandSelectionActionKind, "copy">, string> = {
  translate: "Translate",
  explain: "Explain",
  summarize: "Summarize",
  ask: "Ask",
  search: "Search",
}

function buildInstruction(
  kind: Exclude<IslandSelectionActionKind, "copy">,
  options: SelectionActionPromptOptions,
) {
  switch (kind) {
    case "translate": {
      const source = options.translateSource?.trim() || "auto-detected source language"
      const target = options.translateTarget?.trim() || "the user's current language"
      return [
        `Translate the selected text from ${source} into ${target}.`,
        "Preserve formatting, names, code, and technical terms.",
        "Return only the translation unless clarification is required.",
      ].join(" ")
    }
    case "explain":
      return "Explain the selected text. Start with a one-sentence meaning, then give the key context and any terms that may be confusing."
    case "summarize":
      return "Summarize the selected text into concise bullet points, preserving key facts, entities, numbers, and caveats."
    case "ask":
      return "Use the selected text as context and answer the user's question."
    case "search":
      return "Search or reason from available tools about the selected text. If no search tool is available, answer from the selected text and say what would require external lookup."
  }
}

export function buildSelectionActionPrompt(
  kind: Exclude<IslandSelectionActionKind, "copy">,
  context: IslandSelectionContext,
  options: SelectionActionPromptOptions = {},
) {
  const question = options.question?.trim()
  const sections = [
    "[Selected Text]",
    context.text,
    "",
    "[Action]",
    `${ACTION_LABELS[kind]}: ${buildInstruction(kind, options)}`,
  ]

  if (kind === "ask" && question) {
    sections.push("", "[User Question]", question)
  }

  return sections.join("\n")
}

export function buildSelectionActionSummary(
  kind: Exclude<IslandSelectionActionKind, "copy">,
  context: IslandSelectionContext,
  options: SelectionActionPromptOptions = {},
) {
  const question = options.question?.trim()
  if (kind === "ask" && question) {
    return `Ask about selected text: ${question}`
  }
  if (kind === "translate") {
    return `Translate selected text to ${options.translateTarget || "current language"}`
  }
  return `${ACTION_LABELS[kind]} selected text: ${context.preview}`
}
