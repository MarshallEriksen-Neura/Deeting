import {
  clickLocalBrowserAgentElement,
  getLocalBrowserAgentBridgeStatus,
  getLocalBrowserAgentBridgeUrl,
  getLocalBrowserAgentPageSnapshot,
  navigateLocalBrowserAgentTab,
  openLocalBrowserAgentTab,
  queryLocalBrowserAgentDom,
  setLocalBrowserAgentBridgeUrl,
  typeLocalBrowserAgentElement,
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
      .mockResolvedValueOnce({ tabId: 42, url: "https://example.com/search" } as unknown)
      .mockResolvedValueOnce({ tabId: 42, url: "https://example.com/docs" } as unknown)

    const status = await getLocalBrowserAgentBridgeStatus()
    const currentUrl = await getLocalBrowserAgentBridgeUrl()
    const savedUrl = await setLocalBrowserAgentBridgeUrl("ws://127.0.0.1:31938/bridge")
    const snapshot = await getLocalBrowserAgentPageSnapshot(42)
    const clickResult = await clickLocalBrowserAgentElement(42, { text: "Continue" })
    const typeResult = await typeLocalBrowserAgentElement(
      42,
      { selector: "input[name='q']" },
      "browser agent"
    )
    const queryResult = await queryLocalBrowserAgentDom(42, { selector: ".result" })
    const navigateResult = await navigateLocalBrowserAgentTab(42, "https://example.com/search")
    const openResult = await openLocalBrowserAgentTab("https://example.com/docs")

    expect(status.connected_sessions).toBe(1)
    expect(currentUrl).toBe("ws://127.0.0.1:31937/bridge")
    expect(savedUrl).toBe("ws://127.0.0.1:31938/bridge")
    expect(snapshot.title).toBe("Example Docs")
    expect(clickResult.ok).toBe(true)
    expect(typeResult.ok).toBe(true)
    expect(queryResult.data[0]?.text).toBe("Result 1")
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
      "get_local_browser_agent_page_snapshot",
      { tabId: 42 }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      5,
      "click_local_browser_agent_element",
      { tabId: 42, target: { text: "Continue" } }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      6,
      "type_local_browser_agent_element",
      { tabId: 42, target: { selector: "input[name='q']" }, text: "browser agent" }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      7,
      "query_local_browser_agent_dom",
      { tabId: 42, selector: ".result", textQuery: null }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      8,
      "navigate_local_browser_agent_tab",
      { tabId: 42, url: "https://example.com/search" }
    )
    expect(mockInvoke).toHaveBeenNthCalledWith(
      9,
      "open_local_browser_agent_tab",
      { url: "https://example.com/docs" }
    )
  })
})
