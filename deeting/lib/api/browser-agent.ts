import { z } from "zod"

const isTauriRuntime = () =>
  process.env.NEXT_PUBLIC_IS_TAURI === "true" &&
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core")
  return invoke<T>(command, args)
}

export const BrowserAgentBridgeStatusSchema = z.object({
  bridge_url: z.string(),
  config_source: z.string(),
  configured: z.boolean(),
  running: z.boolean(),
  connected_sessions: z.number(),
  active_session_id: z.string().nullable().optional(),
  reachable: z.boolean(),
  status: z.string(),
  status_reason: z.string(),
})

export const BrowserAgentActivePageSchema = z.object({
  tabId: z.number(),
  title: z.string(),
  url: z.string(),
  host: z.string(),
})

export const BrowserAgentOpenTabResultSchema = z.object({
  tabId: z.number().nullable().optional(),
  url: z.string(),
})

export const BrowserAgentNavigateTabResultSchema = z.object({
  tabId: z.number().nullable().optional(),
  url: z.string(),
})

export const BrowserAgentElementLocatorSchema = z.object({
  selector: z.string().optional(),
  text: z.string().optional(),
  role: z.string().optional(),
  tagName: z.string().optional(),
  placeholder: z.string().optional(),
  index: z.number().optional(),
})

export const BrowserAgentWaitForElementResultSchema = z.object({
  ok: z.boolean(),
  matched: z.boolean(),
  locator: BrowserAgentElementLocatorSchema.nullable(),
  visible: z.boolean(),
  url: z.string(),
  title: z.string(),
})

export const BrowserAgentWaitForNavigationResultSchema = z.object({
  ok: z.boolean(),
  url: z.string(),
  title: z.string(),
  documentReadyState: z.string(),
  changed: z.boolean(),
})

export const BrowserAgentScrollIntoViewResultSchema = z.object({
  ok: z.boolean(),
  visible: z.boolean(),
})

export const BrowserAgentScrollPageResultSchema = z.object({
  ok: z.boolean(),
})

export const BrowserAgentRetryWithRelocateResultSchema = z.object({
  ok: z.boolean(),
  attempts: z.number(),
  recovered: z.boolean(),
  final_error: z.string().nullable(),
  last_snapshot_summary: z
    .object({
      url: z.string(),
      title: z.string(),
      documentReadyState: z.string(),
    })
    .nullable(),
})

export const BrowserAgentDomQuerySchema = z.object({
  selector: z.string().optional(),
  textQuery: z.string().nullable().optional(),
})

export const BrowserAgentDomQueryResultSchema = z.object({
  data: z.array(
    z.object({
      text: z.string().optional(),
      html: z.string().optional(),
    })
  ),
})

export const BrowserAgentPageSnapshotSchema = z.object({
  url: z.string(),
  title: z.string(),
  documentReadyState: z.string(),
  visibleText: z.string(),
  mainText: z.string(),
  headings: z.array(z.object({ level: z.number(), text: z.string() })),
  links: z.array(z.object({ text: z.string(), href: z.string() })),
  buttons: z.array(z.object({ text: z.string(), disabled: z.boolean() })),
  inputs: z.array(
    z.object({
      type: z.string().optional(),
      name: z.string().optional(),
      placeholder: z.string().optional(),
    })
  ),
  forms: z.array(
    z.object({
      action: z.string().optional(),
      method: z.string().optional(),
    })
  ),
})

export type BrowserAgentBridgeStatus = z.infer<typeof BrowserAgentBridgeStatusSchema>
export type BrowserAgentActivePage = z.infer<typeof BrowserAgentActivePageSchema>
export type BrowserAgentElementLocator = z.infer<typeof BrowserAgentElementLocatorSchema>
export type BrowserAgentOpenTabResult = z.infer<typeof BrowserAgentOpenTabResultSchema>
export type BrowserAgentNavigateTabResult = z.infer<typeof BrowserAgentNavigateTabResultSchema>
export type BrowserAgentDomQuery = z.infer<typeof BrowserAgentDomQuerySchema>
export type BrowserAgentDomQueryResult = z.infer<typeof BrowserAgentDomQueryResultSchema>
export type BrowserAgentPageSnapshot = z.infer<typeof BrowserAgentPageSnapshotSchema>
export type BrowserAgentWaitForElementResult = z.infer<typeof BrowserAgentWaitForElementResultSchema>
export type BrowserAgentWaitForNavigationResult = z.infer<typeof BrowserAgentWaitForNavigationResultSchema>
export type BrowserAgentScrollIntoViewResult = z.infer<typeof BrowserAgentScrollIntoViewResultSchema>
export type BrowserAgentScrollPageResult = z.infer<typeof BrowserAgentScrollPageResultSchema>
export type BrowserAgentRetryWithRelocateResult = z.infer<typeof BrowserAgentRetryWithRelocateResultSchema>

function parseBrowserAgentPageSnapshot(data: unknown): BrowserAgentPageSnapshot {
  const direct = BrowserAgentPageSnapshotSchema.safeParse(data)
  if (direct.success) {
    return direct.data
  }

  const wrapped = z
    .object({
      data: BrowserAgentPageSnapshotSchema,
    })
    .safeParse(data)
  if (wrapped.success) {
    return wrapped.data.data
  }

  return BrowserAgentPageSnapshotSchema.parse(data)
}

export async function getLocalBrowserAgentBridgeStatus(): Promise<BrowserAgentBridgeStatus> {
  if (!isTauriRuntime()) {
    return BrowserAgentBridgeStatusSchema.parse({
      bridge_url: "ws://127.0.0.1:31937/bridge",
      config_source: "unsupported",
      configured: false,
      running: false,
      connected_sessions: 0,
      active_session_id: null,
      reachable: false,
      status: "unsupported",
      status_reason: "browser_agent_desktop_only",
    })
  }

  const data = await invokeTauri<unknown>("get_local_browser_agent_bridge_status")
  return BrowserAgentBridgeStatusSchema.parse(data)
}

export async function getLocalBrowserAgentBridgeUrl(): Promise<string> {
  if (!isTauriRuntime()) {
    return "ws://127.0.0.1:31937/bridge"
  }
  return invokeTauri<string>("get_local_browser_agent_bridge_url")
}

export async function setLocalBrowserAgentBridgeUrl(url: string): Promise<string> {
  if (!isTauriRuntime()) {
    return url.trim()
  }
  return invokeTauri<string>("set_local_browser_agent_bridge_url", { url })
}

export async function openLocalBrowserAgentTab(
  url: string
): Promise<BrowserAgentOpenTabResult> {
  if (!isTauriRuntime()) {
    throw new Error("openLocalBrowserAgentTab is only supported in Tauri runtime")
  }
  const data = await invokeTauri<unknown>("open_local_browser_agent_tab", { url })
  return BrowserAgentOpenTabResultSchema.parse(data)
}

export async function navigateLocalBrowserAgentTab(
  tabId: number,
  url: string
): Promise<BrowserAgentNavigateTabResult> {
  if (!isTauriRuntime()) {
    throw new Error("navigateLocalBrowserAgentTab is only supported in Tauri runtime")
  }
  const data = await invokeTauri<unknown>("navigate_local_browser_agent_tab", { tabId, url })
  return BrowserAgentNavigateTabResultSchema.parse(data)
}

export async function getLocalBrowserAgentPageSnapshot(
  tabId: number
): Promise<BrowserAgentPageSnapshot> {
  if (!isTauriRuntime()) {
    throw new Error("getLocalBrowserAgentPageSnapshot is only supported in Tauri runtime")
  }
  const data = await invokeTauri<unknown>("get_local_browser_agent_page_snapshot", { tabId })
  return parseBrowserAgentPageSnapshot(data)
}

export async function getLocalBrowserAgentActivePage(): Promise<BrowserAgentActivePage | null> {
  if (!isTauriRuntime()) {
    return null
  }
  const data = await invokeTauri<unknown>("get_local_browser_agent_active_page")
  if (data == null) {
    return null
  }
  return BrowserAgentActivePageSchema.parse(data)
}

export async function queryLocalBrowserAgentDom(
  tabId: number,
  query: BrowserAgentDomQuery
): Promise<BrowserAgentDomQueryResult> {
  if (!isTauriRuntime()) {
    throw new Error("queryLocalBrowserAgentDom is only supported in Tauri runtime")
  }
  const normalized = BrowserAgentDomQuerySchema.parse(query)
  const data = await invokeTauri<unknown>("query_local_browser_agent_dom", {
    tabId,
    selector: normalized.selector ?? null,
    textQuery: normalized.textQuery ?? null,
  })
  return BrowserAgentDomQueryResultSchema.parse(data)
}

export async function waitForLocalBrowserAgentElement(
  tabId: number,
  input: {
    target: BrowserAgentElementLocator
    timeoutMs: number
    pollIntervalMs: number
  }
): Promise<BrowserAgentWaitForElementResult> {
  if (!isTauriRuntime()) {
    throw new Error("waitForLocalBrowserAgentElement is only supported in Tauri runtime")
  }
  const data = await invokeTauri<unknown>("wait_for_local_browser_agent_element", {
    tabId,
    target: BrowserAgentElementLocatorSchema.parse(input.target),
    timeoutMs: input.timeoutMs,
    pollIntervalMs: input.pollIntervalMs,
  })
  return BrowserAgentWaitForElementResultSchema.parse(data)
}

export async function waitForLocalBrowserAgentNavigation(
  tabId: number,
  input: {
    timeoutMs: number
    expectedUrlContains?: string | null
    expectedTitleContains?: string | null
    waitForReadyState?: "loading" | "interactive" | "complete" | null
  }
): Promise<BrowserAgentWaitForNavigationResult> {
  if (!isTauriRuntime()) {
    throw new Error("waitForLocalBrowserAgentNavigation is only supported in Tauri runtime")
  }
  const data = await invokeTauri<unknown>("wait_for_local_browser_agent_navigation", {
    tabId,
    timeoutMs: input.timeoutMs,
    expectedUrlContains: input.expectedUrlContains ?? null,
    expectedTitleContains: input.expectedTitleContains ?? null,
    waitForReadyState: input.waitForReadyState ?? null,
  })
  return BrowserAgentWaitForNavigationResultSchema.parse(data)
}

export async function scrollLocalBrowserAgentElementIntoView(
  tabId: number,
  input: {
    target: BrowserAgentElementLocator
    align?: "start" | "center" | "end" | "nearest"
  }
): Promise<BrowserAgentScrollIntoViewResult> {
  if (!isTauriRuntime()) {
    throw new Error("scrollLocalBrowserAgentElementIntoView is only supported in Tauri runtime")
  }
  const data = await invokeTauri<unknown>("scroll_local_browser_agent_element_into_view", {
    tabId,
    target: BrowserAgentElementLocatorSchema.parse(input.target),
    align: input.align ?? null,
  })
  return BrowserAgentScrollIntoViewResultSchema.parse(data)
}

export async function scrollLocalBrowserAgentPage(
  tabId: number,
  input: {
    direction: "up" | "down"
    amount?: number | null
  }
): Promise<BrowserAgentScrollPageResult> {
  if (!isTauriRuntime()) {
    throw new Error("scrollLocalBrowserAgentPage is only supported in Tauri runtime")
  }
  const data = await invokeTauri<unknown>("scroll_local_browser_agent_page", {
    tabId,
    direction: input.direction,
    amount: input.amount ?? null,
  })
  return BrowserAgentScrollPageResultSchema.parse(data)
}

export async function retryLocalBrowserAgentWithRelocate(
  tabId: number,
  input: {
    actionKind: "click" | "type"
    target: BrowserAgentElementLocator
    text?: string | null
    maxAttempts: number
    timeoutMs: number
    pollIntervalMs: number
  }
): Promise<BrowserAgentRetryWithRelocateResult> {
  if (!isTauriRuntime()) {
    throw new Error("retryLocalBrowserAgentWithRelocate is only supported in Tauri runtime")
  }
  const data = await invokeTauri<unknown>("retry_local_browser_agent_with_relocate", {
    tabId,
    actionKind: input.actionKind,
    target: BrowserAgentElementLocatorSchema.parse(input.target),
    text: input.text ?? null,
    maxAttempts: input.maxAttempts,
    timeoutMs: input.timeoutMs,
    pollIntervalMs: input.pollIntervalMs,
  })
  return BrowserAgentRetryWithRelocateResultSchema.parse(data)
}

export async function clickLocalBrowserAgentElement(
  tabId: number,
  target: BrowserAgentElementLocator
): Promise<{ ok: boolean }> {
  if (!isTauriRuntime()) {
    throw new Error("clickLocalBrowserAgentElement is only supported in Tauri runtime")
  }
  const data = await invokeTauri<unknown>("click_local_browser_agent_element", { tabId, target })
  return z.object({ ok: z.boolean() }).parse(data)
}

export async function typeLocalBrowserAgentElement(
  tabId: number,
  target: BrowserAgentElementLocator,
  text: string
): Promise<{ ok: boolean }> {
  if (!isTauriRuntime()) {
    throw new Error("typeLocalBrowserAgentElement is only supported in Tauri runtime")
  }
  const data = await invokeTauri<unknown>("type_local_browser_agent_element", {
    tabId,
    target,
    text,
  })
  return z.object({ ok: z.boolean() }).parse(data)
}
