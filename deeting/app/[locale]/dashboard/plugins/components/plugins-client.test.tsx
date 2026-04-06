import React from "react"
import { act } from "react"
import { hydrateRoot } from "react-dom/client"
import { MessageChannel } from "worker_threads"
import { TextDecoder, TextEncoder } from "util"

import { PluginsClient } from "./plugins-client"
import {
  fetchLocalSkillRuntimeStatuses,
  installLocalSkillRuntime,
  installPlugin,
  isDesktopRuntime,
  submitPluginRepo,
  uninstallPlugin,
  updateLocalSkillRuntimeSettings,
} from "@/lib/api/plugin-market"

if (!globalThis.MessageChannel) {
  globalThis.MessageChannel = MessageChannel as typeof globalThis.MessageChannel
}

if (!globalThis.TextEncoder) {
  globalThis.TextEncoder = TextEncoder
}

if (!globalThis.TextDecoder) {
  globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder
}

const mockMutate = jest.fn()

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>,
}))

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    asChild,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) =>
    asChild ? <div>{children}</div> : <button {...props}>{children}</button>,
}))

jest.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

jest.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}))

jest.mock("@/components/plugins/plugin-card", () => ({
  PluginCard: ({ plugin }: { plugin: { id: string } }) => <div>{plugin.id}</div>,
}))

jest.mock("@/components/plugins/permission-confirm-dialog", () => ({
  PermissionConfirmDialog: () => null,
}))

jest.mock("@/components/plugins/import-repo-dialog", () => ({
  ImportRepoDialog: () => null,
}))

jest.mock("@/components/plugins/skill-runtime-config-sheet", () => ({
  SkillRuntimeConfigSheet: () => null,
}))

jest.mock("@/hooks/use-debounce", () => ({
  useDebounce: (value: string) => value,
}))

jest.mock("@/lib/swr/use-plugin-market", () => ({
  usePluginMarket: () => ({
    plugins: [],
    isLoading: false,
    error: null,
    mutate: mockMutate,
  }),
}))

jest.mock("@/lib/plugins/plugin-runtime-view", () => ({
  buildPluginRuntimeViewModel: (plugins: unknown[]) => ({
    userVisiblePlugins: plugins,
    installedPlugins: [],
    runtimeStatusByPluginId: {},
  }),
}))

jest.mock("@/lib/api/plugin-market", () => ({
  isDesktopRuntime: jest.fn(),
  fetchLocalSkillRuntimeStatuses: jest.fn(),
  installPlugin: jest.fn(),
  uninstallPlugin: jest.fn(),
  submitPluginRepo: jest.fn(),
  updateLocalSkillRuntimeSettings: jest.fn(),
  installLocalSkillRuntime: jest.fn(),
}))

const mockIsDesktopRuntime = isDesktopRuntime as jest.MockedFunction<typeof isDesktopRuntime>
const mockFetchLocalSkillRuntimeStatuses =
  fetchLocalSkillRuntimeStatuses as jest.MockedFunction<typeof fetchLocalSkillRuntimeStatuses>

describe("PluginsClient hydration", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDesktopRuntime.mockReturnValue(false)
    mockFetchLocalSkillRuntimeStatuses.mockResolvedValue([])
    ;(installPlugin as jest.MockedFunction<typeof installPlugin>).mockResolvedValue({
      skill_id: "skill.demo",
      tool_count: 1,
      install_path: "C:/skills/demo",
    })
    ;(uninstallPlugin as jest.MockedFunction<typeof uninstallPlugin>).mockResolvedValue(null)
    ;(submitPluginRepo as jest.MockedFunction<typeof submitPluginRepo>).mockResolvedValue(undefined)
    ;(
      updateLocalSkillRuntimeSettings as jest.MockedFunction<
        typeof updateLocalSkillRuntimeSettings
      >
    ).mockResolvedValue({
      skill_id: "skill.demo",
      display_name: "Demo",
      installed_version: null,
      is_enabled: true,
      execution_mode: "local",
      ecosystem: "python",
      adapter_kind: "unknown",
      normalized_execution_surface: "recipe",
      runnable_now: true,
      required_bins: [],
      missing_bins: [],
      required_env: [],
      missing_env: [],
      required_config: [],
      missing_config: [],
      blocking_reason: null,
      install_hints: [],
      runtime_install_supported: false,
      runtime_kind: null,
      runtime_install_state: "unsupported",
      runtime_install_manager: null,
      runtime_manager_available: false,
      runtime_install_error: null,
      runtime_dependency_manifest_path: null,
      runtime_command_path: null,
      compatibility: null,
      current_env: {},
      current_config: {},
    })
    ;(
      installLocalSkillRuntime as jest.MockedFunction<typeof installLocalSkillRuntime>
    ).mockResolvedValue({
      skill_id: "skill.demo",
      display_name: "Demo",
      installed_version: null,
      is_enabled: true,
      execution_mode: "local",
      ecosystem: "python",
      adapter_kind: "unknown",
      normalized_execution_surface: "recipe",
      runnable_now: true,
      required_bins: [],
      missing_bins: [],
      required_env: [],
      missing_env: [],
      required_config: [],
      missing_config: [],
      blocking_reason: null,
      install_hints: [],
      runtime_install_supported: false,
      runtime_kind: null,
      runtime_install_state: "unsupported",
      runtime_install_manager: null,
      runtime_manager_available: false,
      runtime_install_error: null,
      runtime_dependency_manifest_path: null,
      runtime_command_path: null,
      compatibility: null,
      current_env: {},
      current_config: {},
    })
  })

  it("does not trigger hydration mismatch when desktop runtime resolves after mount", async () => {
    const { renderToString } = await import("react-dom/server")
    const serverHtml = renderToString(<PluginsClient mode="installed" />)
    const container = document.createElement("div")
    container.innerHTML = serverHtml
    document.body.appendChild(container)

    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {})

    mockIsDesktopRuntime.mockReturnValue(true)

    let root: ReturnType<typeof hydrateRoot> | null = null

    await act(async () => {
      root = hydrateRoot(container, <PluginsClient mode="installed" />)
      await Promise.resolve()
    })

    expect(
      consoleErrorSpy.mock.calls.some(([message]) =>
        typeof message === "string" && message.includes("Hydration failed")
      )
    ).toBe(false)
    expect(mockFetchLocalSkillRuntimeStatuses).toHaveBeenCalledTimes(1)

    root?.unmount()
    consoleErrorSpy.mockRestore()
    container.remove()
  })
})
