export type BrowserLookupKind =
  | "search_wiki"
  | "search_memory"
  | "ask_current_page"

export interface IslandBrowserLookupPageContext {
  tabId: number
  title: string
  url: string
  host: string
  headingsSummary: string[]
  mainTextSnippet: string
  visibleTextSnippet: string
}

export interface IslandBrowserLookupHit {
  id: string
  source: "wiki" | "memory"
  title: string
  summary: string
  subtitle?: string | null
  score: number
}

export interface IslandBrowserLookupPayload {
  lookupId: string
  kind: BrowserLookupKind
  queryText: string
  pageContext: IslandBrowserLookupPageContext
  hits: IslandBrowserLookupHit[]
  createdAt: number
}

export interface IslandBrowserLookupAttachPayload {
  lookupId: string
  prompt: string
  pageContext: IslandBrowserLookupPageContext
}

export interface IslandBrowserLookupDismissPayload {
  lookupId: string
}
