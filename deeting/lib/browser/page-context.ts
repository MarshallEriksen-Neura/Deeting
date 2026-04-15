import type {
  BrowserAgentActivePage,
  BrowserAgentPageSnapshot,
} from "@/lib/api/browser-agent"

export interface ChatPageContextAttachment {
  tabId: number | null
  title: string
  url: string
  host: string
  headingsSummary: string[]
  mainTextSnippet: string
  visibleTextSnippet: string
  capturedAt: number
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function clipText(value: string, maxChars: number) {
  const normalized = normalizeWhitespace(value)
  if (normalized.length <= maxChars) {
    return normalized
  }
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`
}

function summarizeHeadings(snapshot: BrowserAgentPageSnapshot) {
  return Array.from(
    new Set(
      snapshot.headings
        .map((heading) => normalizeWhitespace(heading.text))
        .filter((heading) => heading.length > 0)
    )
  ).slice(0, 6)
}

export function buildChatPageContextAttachment(
  snapshot: BrowserAgentPageSnapshot,
  activePage?: BrowserAgentActivePage | null
): ChatPageContextAttachment {
  const url = snapshot.url.trim()
  const title = snapshot.title.trim()
  const host = activePage?.host?.trim() || (() => {
    try {
      return new URL(url).host
    } catch {
      return ""
    }
  })()

  return {
    tabId: activePage?.tabId ?? null,
    title,
    url,
    host,
    headingsSummary: summarizeHeadings(snapshot),
    mainTextSnippet: clipText(snapshot.mainText || snapshot.visibleText || "", 1400),
    visibleTextSnippet: clipText(snapshot.visibleText || snapshot.mainText || "", 700),
    capturedAt: Date.now(),
  }
}

export function buildChatPageContextSystemPrompt(
  context: ChatPageContextAttachment
): string {
  const lines = [
    "Transient browser page context for the user's current request.",
    "Use it only to interpret the latest user message.",
    "Do not claim details that are not supported by this snapshot.",
    `Page title: ${context.title || "(untitled page)"}`,
    `Page URL: ${context.url || "(unknown url)"}`,
  ]

  if (context.host) {
    lines.push(`Page host: ${context.host}`)
  }

  if (context.headingsSummary.length > 0) {
    lines.push("Visible headings:")
    for (const heading of context.headingsSummary) {
      lines.push(`- ${heading}`)
    }
  }

  if (context.mainTextSnippet) {
    lines.push("Main page excerpt:")
    lines.push(context.mainTextSnippet)
  } else if (context.visibleTextSnippet) {
    lines.push("Visible page excerpt:")
    lines.push(context.visibleTextSnippet)
  }

  return lines.join("\n")
}

