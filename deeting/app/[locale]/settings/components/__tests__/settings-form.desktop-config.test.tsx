import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { SettingsForm } from "../settings-form"

function setNodeEnv(value: string | undefined) {
  Reflect.set(process.env, "NODE_ENV", value)
}

const mockGetDesktopNetworkProxySettings = jest.fn(async () => ({
  mode: "system" as const,
  url: "",
}))
const mockGetDesktopScoutBaseUrl = jest.fn(async () => "http://scout:8001")
const mockFetchDesktopObjectStorageConfig = jest.fn(async () => ({
  provider: "cloudflare_r2_s3",
  bucket: "bucket",
  region: "auto",
  endpoint: "https://example.com",
  public_base_url: "https://cdn.example.com",
  path_prefix: "assets",
  access_key_id: "key-id",
  is_path_style: false,
  is_enabled: true,
}))

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

jest.mock("next-intl", () => ({
  useLocale: () => "zh-CN",
}))

jest.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock("@/hooks/use-chat-models", () => ({
  useChatModels: () => ({ modelGroups: [], isLoadingModels: false }),
}))

jest.mock("@/lib/swr/use-embedding-settings", () => ({
  useUserSecretary: () => ({ data: null, isLoading: false, mutate: jest.fn() }),
  useUserEmbeddingConfig: () => ({ data: null, isLoading: false, mutate: jest.fn() }),
}))

jest.mock("@/lib/api/desktop-config", () => ({
  getDesktopNetworkProxySettings: () => mockGetDesktopNetworkProxySettings(),
  setDesktopNetworkProxySettings: jest.fn(),
  getDesktopScoutBaseUrl: () => mockGetDesktopScoutBaseUrl(),
  setDesktopScoutBaseUrl: jest.fn(),
  normalizeDesktopProxyMode: (value: string) => value,
}))

jest.mock("@/lib/api/desktop-object-storage", () => ({
  fetchDesktopObjectStorageConfig: () => mockFetchDesktopObjectStorageConfig(),
  updateDesktopObjectStorageConfig: jest.fn(),
}))

jest.mock("@/components/ui/form", () => {
  const actual = jest.requireActual("@/components/ui/form")
  return {
    ...actual,
    Form: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  }
})

jest.mock("../desktop-embedding-settings-card", () => ({
  DesktopEmbeddingSettingsCard: () => null,
}))

jest.mock("../desktop-multimodal-settings-card", () => ({
  DesktopMultimodalSettingsCard: () => null,
}))

jest.mock("../personal-settings-card", () => ({
  PersonalSettingsCard: () => null,
}))

jest.mock("../settings-form-actions", () => ({
  SettingsFormActions: () => null,
}))

jest.mock("../settings-lazy", () => ({
  DeferredAgentSettingsCard: () => null,
  DeferredDesktopBrowserAgentPanelCard: () => (
    <div data-testid="browser-agent-panel">browser panel</div>
  ),
  DeferredDesktopSandboxSettingsCard: () => null,
  DeferredDesktopVersionManagementCard: () => null,
  DeferredDesktopWindowSettingsCard: () => null,
  DeferredDesktopObjectStorageSettingsCard: () => null,
  DeferredDesktopNetworkSettingsCard: () => null,
  DeferredDesktopScoutSettingsCard: () => null,
}))

jest.mock("../settings-nav", () => ({
  SettingsNav: ({
    onSectionChange,
  }: {
    onSectionChange: (
      section:
        | "models"
        | "storage"
        | "agent"
        | "browser"
        | "relay"
        | "window"
        | "version"
    ) => void
  }) => (
    <div>
      <button type="button" onClick={() => onSectionChange("models")}>
        models
      </button>
      <button type="button" onClick={() => onSectionChange("storage")}>
        storage
      </button>
      <button type="button" onClick={() => onSectionChange("agent")}>
        agent
      </button>
      <button type="button" onClick={() => onSectionChange("browser")}>
        browser
      </button>
      <button type="button" onClick={() => onSectionChange("relay")}>
        relay
      </button>
      <button type="button" onClick={() => onSectionChange("window")}>
        window
      </button>
      <button type="button" onClick={() => onSectionChange("version")}>
        version
      </button>
    </div>
  ),
}))

describe("SettingsForm desktop config loading", () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalBrowserPanelFlag =
    process.env.NEXT_PUBLIC_ENABLE_BROWSER_AGENT_PANEL

  beforeEach(() => {
    mockGetDesktopNetworkProxySettings.mockClear()
    mockGetDesktopScoutBaseUrl.mockClear()
    mockFetchDesktopObjectStorageConfig.mockClear()
    setNodeEnv(originalNodeEnv)
    if (originalBrowserPanelFlag === undefined) {
      delete process.env.NEXT_PUBLIC_ENABLE_BROWSER_AGENT_PANEL
    } else {
      process.env.NEXT_PUBLIC_ENABLE_BROWSER_AGENT_PANEL =
        originalBrowserPanelFlag
    }
  })

  it("loads desktop scout and storage settings only after their sections are opened", async () => {
    render(<SettingsForm isAuthenticated isTauriRuntime />)

    expect(mockGetDesktopNetworkProxySettings).not.toHaveBeenCalled()
    expect(mockGetDesktopScoutBaseUrl).not.toHaveBeenCalled()
    expect(mockFetchDesktopObjectStorageConfig).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "relay" }))

    await waitFor(() => {
      expect(mockGetDesktopNetworkProxySettings).toHaveBeenCalledTimes(1)
      expect(mockGetDesktopScoutBaseUrl).toHaveBeenCalledTimes(1)
    })
    expect(mockFetchDesktopObjectStorageConfig).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "storage" }))

    await waitFor(() => {
      expect(mockFetchDesktopObjectStorageConfig).toHaveBeenCalledTimes(1)
    })
  })

  it("shows the browser agent panel only in the dedicated browser section", () => {
    render(<SettingsForm isAuthenticated isTauriRuntime />)

    expect(screen.queryByTestId("browser-agent-panel")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "agent" }))
    expect(screen.queryByTestId("browser-agent-panel")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "browser" }))
    expect(screen.getByTestId("browser-agent-panel")).toBeInTheDocument()
  })

  it("does not render the browser section in production when the panel flag is off", () => {
    setNodeEnv("production")
    delete process.env.NEXT_PUBLIC_ENABLE_BROWSER_AGENT_PANEL

    render(<SettingsForm isAuthenticated isTauriRuntime />)

    fireEvent.click(screen.getByRole("button", { name: "browser" }))
    expect(screen.queryByTestId("browser-agent-panel")).not.toBeInTheDocument()
  })

  it("still renders the browser section in production when the panel flag is on", () => {
    setNodeEnv("production")
    process.env.NEXT_PUBLIC_ENABLE_BROWSER_AGENT_PANEL = "true"

    render(<SettingsForm isAuthenticated isTauriRuntime />)

    fireEvent.click(screen.getByRole("button", { name: "browser" }))
    expect(screen.getByTestId("browser-agent-panel")).toBeInTheDocument()
  })

})
