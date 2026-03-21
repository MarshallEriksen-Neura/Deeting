import { render, waitFor } from "@testing-library/react"

import { DesktopAuthBootstrap } from "../desktop-auth-bootstrap"
import { useAuthStore } from "@/store/auth-store"
import { useDesktopAuthBootstrapStore } from "@/store/desktop-auth-bootstrap-store"

const mockGetDesktopConfig = jest.fn()

jest.mock("@/lib/api/desktop-config", () => ({
  DESKTOP_CONFIG_KEYS: {
    authToken: "auth.token",
  },
  getDesktopConfig: (...args: unknown[]) => mockGetDesktopConfig(...args),
  isTauriRuntime: () => true,
}))

describe("DesktopAuthBootstrap", () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuthStore.getState().clearSession()
    useDesktopAuthBootstrapStore.setState({ isReady: false })
    mockGetDesktopConfig.mockReset()
  })

  it("restores the persisted desktop auth token into the auth store", async () => {
    mockGetDesktopConfig.mockResolvedValueOnce("desktop-token")

    render(<DesktopAuthBootstrap />)

    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBe("desktop-token")
      expect(useAuthStore.getState().isAuthenticated).toBe(true)
      expect(useDesktopAuthBootstrapStore.getState().isReady).toBe(true)
    })

    expect(mockGetDesktopConfig).toHaveBeenCalledWith("auth.token")
  })

  it("skips desktop config recovery when the store already has an authenticated session", async () => {
    useAuthStore.getState().setSession({
      accessToken: "existing-token",
      tokenType: "bearer",
    })

    render(<DesktopAuthBootstrap />)

    await waitFor(() => {
      expect(useDesktopAuthBootstrapStore.getState().isReady).toBe(true)
    })

    expect(mockGetDesktopConfig).not.toHaveBeenCalled()
    expect(useAuthStore.getState().accessToken).toBe("existing-token")
  })
})
