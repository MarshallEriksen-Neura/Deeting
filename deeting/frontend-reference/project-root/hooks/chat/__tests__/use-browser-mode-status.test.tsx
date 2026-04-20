import { renderHook, waitFor } from "@testing-library/react"
import {
  getLocalBrowserAgentBridgeStatus,
  type BrowserAgentBridgeStatus,
} from "@/lib/api/browser-agent"
import { useBrowserModeStatus } from "@/hooks/chat/use-browser-mode-status"

jest.mock("@/lib/api/browser-agent", () => ({
  getLocalBrowserAgentBridgeStatus: jest.fn(),
}))

const mockGetLocalBrowserAgentBridgeStatus =
  getLocalBrowserAgentBridgeStatus as jest.MockedFunction<
    typeof getLocalBrowserAgentBridgeStatus
  >

function buildStatus(
  overrides: Partial<BrowserAgentBridgeStatus>
): BrowserAgentBridgeStatus {
  return {
    bridge_url: "ws://127.0.0.1:31937/bridge",
    config_source: "default",
    configured: false,
    running: false,
    connected_sessions: 0,
    active_session_id: null,
    reachable: false,
    status: "unsupported",
    status_reason: "browser_agent_desktop_only",
    ...overrides,
  }
}

describe("useBrowserModeStatus", () => {
  beforeEach(() => {
    mockGetLocalBrowserAgentBridgeStatus.mockReset()
  })

  it("maps an active extension session to connected", async () => {
    mockGetLocalBrowserAgentBridgeStatus.mockResolvedValueOnce(
      buildStatus({
        running: true,
        reachable: true,
        connected_sessions: 1,
        active_session_id: "sess-1",
        status: "connected",
        status_reason: "browser_agent_extension_connected",
      })
    )

    const { result } = renderHook(() => useBrowserModeStatus(true))

    await waitFor(() => {
      expect(result.current.connectionState).toBe("connected")
    })

    expect(result.current.statusLabel).toBe("connected")
    expect(result.current.statusDetail).toBe("browser_agent_extension_connected")
  })

  it("maps a listening bridge with zero sessions to extension_not_connected", async () => {
    mockGetLocalBrowserAgentBridgeStatus.mockResolvedValueOnce(
      buildStatus({
        running: true,
        reachable: true,
        connected_sessions: 0,
        status: "listening",
        status_reason: "browser_agent_bridge_listening",
      })
    )

    const { result } = renderHook(() => useBrowserModeStatus(true))

    await waitFor(() => {
      expect(result.current.connectionState).toBe("extension_not_connected")
    })

    expect(result.current.statusLabel).toBe("extension_not_connected")
    expect(result.current.statusDetail).toBe("browser_agent_bridge_listening")
  })

  it("maps unsupported desktop availability to unsupported", async () => {
    mockGetLocalBrowserAgentBridgeStatus.mockResolvedValueOnce(
      buildStatus({
        status: "unsupported",
        status_reason: "browser_agent_desktop_only",
      })
    )

    const { result } = renderHook(() => useBrowserModeStatus(true))

    await waitFor(() => {
      expect(result.current.connectionState).toBe("unsupported")
    })
  })
})
