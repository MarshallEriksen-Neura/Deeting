import {
  clickLocalBrowserAgentElement,
  getLocalBrowserAgentActivePage,
  getLocalBrowserAgentBridgeStatus,
  getLocalBrowserAgentBridgeUrl,
  getLocalBrowserAgentPageSnapshot,
  retryLocalBrowserAgentWithRelocate,
  scrollLocalBrowserAgentElementIntoView,
  scrollLocalBrowserAgentPage,
  navigateLocalBrowserAgentTab,
  openLocalBrowserAgentTab,
  queryLocalBrowserAgentDom,
  setLocalBrowserAgentBridgeUrl,
  typeLocalBrowserAgentElement,
  waitForLocalBrowserAgentElement,
  waitForLocalBrowserAgentNavigation,
} from "@/lib/api/browser-agent"
import { invoke } from "@tauri-apps/api/core"

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
}))

const mockInvoke = invoke as jest.MockedFunction<typeof invoke>
const originalTauriFlag = process.env.NEXT_PUBLIC_IS_TAURI
const windowWithTauri = window as Window & {
  __TAURI__?: unknown
  __TAURI_INTERNALS__?: unknown
}

describe("browser agent api", () => {
  afterEach(() => {
    mockInvoke.mockReset()
    process.env.NEXT_PUBLIC_IS_TAURI = originalTauriFlag
    delete windowWithTauri.__TAURI__
    delete windowWithTauri.__TAURI_INTERNALS__
  })

  it("returns an idle browser agent status outside tauri runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"

    const status = await getLocalBrowserAgentBridgeStatus()

    expect(status.running).toBe(false)
    expect(status.connected_sessions).toBe(0)
    expect(status.status).toBe("unsupported")
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("calls tauri browser agent commands in desktop runtime", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke
      .mockResolvedValueOnce({
        bridge_url: "ws://127.0.0.1:31937/bridge",
        config_source: "default",
        configured: false,
        running: true,
        connected_sessions: 1,
        active_session_id: "sess-1",
        reachable: true,
        status: "connected",
        status_reason: "browser_agent_extension_connected",
      } as unknown)
      .mockResolvedValueOnce("ws://127.0.0.1:31937/bridge" as unknown)
      .mockResolvedValueOnce("ws://127.0.0.1:31938/bridge" as unknown)
      .mockResolvedValueOnce({
        tabId: 42,
        title: "Example Docs",
        url: "https://example.com/docs",
        host: "example.com",
      } as unknown)
      .mockResolvedValueOnce({
        url: "https://example.com/docs",
        title: "Example Docs",
        documentReadyState: "complete",
        visibleText: "Visible content",
        mainText: "Main content",
        headings: [{ level: 1, text: "Example Docs" }],
        links: [{ text: "Home", href: "https://example.com/" }],
        buttons: [{ text: "Continue", disabled: false }],
        inputs: [],
        forms: [],
      } as unknown)
      .mockResolvedValueOnce({ ok: true } as unknown)
      .mockResolvedValueOnce({ ok: true } as unknown)
      .mockResolvedValueOnce({
        data: [
          {
            text: "Result 1",
            html: "<div>Result 1</div>",
          },
        ],
      } as unknown)
      .mockResolvedValueOnce({
        ok: true,
        matched: true,
        locator: { text: "Continue" },
        visible: true,
        url: "https://example.com/docs",
        title: "Example Docs",
      } as unknown)
      .mockResolvedValueOnce({
        ok: true,
        url: "https://example.com/dashboard",
        title: "Dashboard",
        documentReadyState: "complete",
        changed: true,
      } as unknown)
      .mockResolvedValueOnce({ ok: true, visible: true } as unknown)
      .mockResolvedValueOnce({ ok: true } as unknown)
      .mockResolvedValueOnce({
        ok: true,
        attempts: 2,
        recovered: true,
        final_error: null,
        last_snapshot_summary: {
          url: "https://example.com/docs",
          title: "Example Docs",
          documentReadyState: "complete",
        },
      } as unknown)
      .mockResolvedValueOnce({ tabId: 42, url: "https://example.com/search" } as unknown)
      .mockResolvedValueOnce({ tabId: 42, url: "https://example.com/docs" } as unknown)

    const status = await getLocalBrowserAgentBridgeStatus()
    const currentUrl = await getLocalBrowserAgentBridgeUrl()
    const savedUrl = await setLocalBrowserAgentBridgeUrl("ws://127.0.0.1:31938/bridge")
    const activePage = await getLocalBrowserAgentActivePage()
    const snapshot = await getLocalBrowserAgentPageSnapshot(42)
    const clickResult = await clickLocalBrowserAgentElement(42, { text: "Continue" })
    const typeResult = await typeLocalBrowserAgentElement(
      42,
      { selector: "input[name='q']" },
      "browser agent"
    )
    const queryResult = await queryLocalBrowserAgentDom(42, { selector: ".result" })
    const waitElementResult = await waitForLocalBrowserAgentElement(42, {
      target: { text: "Continue" },
      timeoutMs: 10_000,
      pollIntervalMs: 250,
    })
    const waitNavigationResult = await waitForLocalBrowserAgentNavigation(42, {
      timeoutMs: 10_000,
      expectedUrlContains: "/dashboard",
      waitForReadyState: "complete",
    })
    const scrollResult = await scrollLocalBrowserAgentElementIntoView(42, {
      target: { selector: "button.primary" },
      align: "center",
    })
    const pageScrollResult = await scrollLocalBrowserAgentPage(42, {
      direction: "down",
      amount: 480,
    })
    const retryResult = await retryLocalBrowserAgentWithRelocate(42, {
      actionKind: "click",
      target: { text: "Continue" },
      maxAttempts: 2,
      timeoutMs: 10_000,
      pollIntervalMs: 250,
    })
    const navigateResult = await navigateLocalBrowserAgentTab(42, "https://example.com/search")
    const openResult = await openLocalBrowserAgentTab("https://example.com/docs")

    expect(status.connected_sessions).toBe(1)
    expect(currentUrl).toBe("ws://127.0.0.1:31937/bridge")
    expect(savedUrl).toBe("ws://127.0.0.1:31938/bridge")
    expect(activePage?.tabId).toBe(42)
    expect(snapshot.title).toBe("Example Docs")
    expect(clickResult.ok).toBe(true)
    expect(typeResult.ok).toBe(true)
    expect(queryResult.data[0]?.text).toBe("Result 1")
    expect(waitElementResult.matched).toBe(true)
    expect(waitNavigationResult.changed).toBe(true)
    expect(scrollResult.visible).toBe(true)
    expect(pageScrollResult.ok).toBe(true)
    expect(retryResult.recovered).toBe(true)
    expect(navigateResult.url).toBe("https://example.com/search")
    expect(openResult.tabId).toBe(42)
    expect(mockInvoke).toHaveBeenNthCalledWith(
      1,
      "get_local_browser_agent_bridge_status",
      undefined
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      2,
      "get_local_browser_agent_bridge_url",
      undefined
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      3,
      "set_local_browser_agent_bridge_url",
      { url: "ws://127.0.0.1:31938/bridge" }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      4,
      "get_local_browser_agent_active_page",
      undefined
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      5,
      "get_local_browser_agent_page_snapshot",
      { tabId: 42 }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      6,
      "click_local_browser_agent_element",
      { tabId: 42, target: { text: "Continue" } }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      7,
      "type_local_browser_agent_element",
      { tabId: 42, target: { selector: "input[name='q']" }, text: "browser agent" }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      8,
      "query_local_browser_agent_dom",
      { tabId: 42, selector: ".result", textQuery: null }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      9,
      "wait_for_local_browser_agent_element",
      {
        tabId: 42,
        target: { text: "Continue" },
        timeoutMs: 10_000,
        pollIntervalMs: 250,
      }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      10,
      "wait_for_local_browser_agent_navigation",
      {
        tabId: 42,
        timeoutMs: 10_000,
        expectedUrlContains: "/dashboard",
        expectedTitleContains: null,
        waitForReadyState: "complete",
      }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      11,
      "scroll_local_browser_agent_element_into_view",
      {
        tabId: 42,
        target: { selector: "button.primary" },
        align: "center",
      }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      12,
      "scroll_local_browser_agent_page",
      {
        tabId: 42,
        direction: "down",
        amount: 480,
      }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      13,
      "retry_local_browser_agent_with_relocate",
      {
        tabId: 42,
        actionKind: "click",
        target: { text: "Continue" },
        text: null,
        maxAttempts: 2,
        timeoutMs: 10_000,
        pollIntervalMs: 250,
      }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      14,
      "navigate_local_browser_agent_tab",
      { tabId: 42, url: "https://example.com/search" }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      15,
      "open_local_browser_agent_tab",
      { url: "https://example.com/docs" }
    )
  })

  it("unwraps wrapped snapshot payloads returned by the browser bridge", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValueOnce({
      ok: true,
      data: {
        url: "https://example.com/docs",
        title: "Example Docs",
        documentReadyState: "complete",
        visibleText: "Visible content",
        mainText: "Main content",
        headings: [{ level: 1, text: "Example Docs" }],
        links: [{ text: "Home", href: "https://example.com/" }],
        buttons: [{ text: "Continue", disabled: false }],
        inputs: [],
        forms: [],
      },
    } as unknown)

    const snapshot = await getLocalBrowserAgentPageSnapshot(42)

    expect(snapshot).toMatchObject({
      url: "https://example.com/docs",
      title: "Example Docs",
      documentReadyState: "complete",
    })
    expect(mockInvoke).toHaveBeenCalledWith("get_local_browser_agent_page_snapshot", {
      tabId: 42,
    })
  })

  it("returns null when the desktop browser agent has no active page", async () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "true"
    windowWithTauri.__TAURI__ = {}
    mockInvoke.mockResolvedValueOnce(null as unknown)

    const activePage = await getLocalBrowserAgentActivePage()

    expect(activePage).toBeNull()
    expect(mockInvoke).toHaveBeenCalledWith(
      "get_local_browser_agent_active_page",
      undefined
    )
  })
})
