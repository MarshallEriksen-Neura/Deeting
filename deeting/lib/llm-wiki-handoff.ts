export const LLM_WIKI_HANDOFF_STORAGE_KEY = "llm_wiki_task_agent_handoff_v1"

export type LlmWikiTaskAgentHandoffBundle = {
  mode: "create" | "edit"
  agentId?: string | null
  name?: string
  description?: string
  taskPrompt?: string
  sourceKind?: string
  sourcePath?: string
  tags?: string[]
}

export function saveLlmWikiTaskAgentHandoff(
  bundle: LlmWikiTaskAgentHandoffBundle,
): void {
  if (typeof window === "undefined") return
  window.sessionStorage.setItem(
    LLM_WIKI_HANDOFF_STORAGE_KEY,
    JSON.stringify(bundle),
  )
}

export function loadLlmWikiTaskAgentHandoff(): LlmWikiTaskAgentHandoffBundle | null {
  if (typeof window === "undefined") return null
  const raw = window.sessionStorage.getItem(LLM_WIKI_HANDOFF_STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as LlmWikiTaskAgentHandoffBundle
  } catch {
    return null
  }
}

export function clearLlmWikiTaskAgentHandoff(): void {
  if (typeof window === "undefined") return
  window.sessionStorage.removeItem(LLM_WIKI_HANDOFF_STORAGE_KEY)
}
