import { render, screen } from "@testing-library/react"

import { PluginsClient as DashboardPluginsClient } from "@/app/[locale]/dashboard/plugins/components/plugins-client"
import { PluginsClient as PublicPluginsClient } from "@/app/[locale]/plugins/components/plugins-client"
import { isDesktopRuntime, type LocalSkillRuntimeStatus } from "@/lib/api/plugin-market"
import { useLocalSkillRuntimeStatuses } from "@/hooks/use-local-skill-runtime-statuses"
import { usePluginMarket } from "@/lib/swr/use-plugin-market"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    <a href={href}>{children}</a>,
}))

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock("@/hooks/use-debounce", () => ({
  useDebounce: (value: string) => value,
}))

jest.mock("@/hooks/use-local-skill-runtime-statuses", () => ({
  useLocalSkillRuntimeStatuses: jest.fn(),
}))

jest.mock("@/lib/swr/use-plugin-market", () => ({
  usePluginMarket: jest.fn(),
}))

jest.mock("@/lib/api/plugin-market", () => ({
  installLocalSkillRuntime: jest.fn(),
  installPlugin: jest.fn(),
  uninstallPlugin: jest.fn(),
  submitPluginRepo: jest.fn(),
  fetchLocalSkillRuntimeStatuses: jest.fn(async () => []),
  updateLocalSkillRuntimeSettings: jest.fn(),
  isDesktopRuntime: jest.fn(),
  isUserVisiblePlugin: (plugin: { source_kind?: string }) => plugin.source_kind !== "official",
}))

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    asChild: _asChild,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => {
    void _asChild
    return <button {...props}>{children}</button>
  },
}))

jest.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  AlertDialogAction: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button {...props}>{children}</button>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

jest.mock("@/components/ui/skeleton", () => ({
  Skeleton: (props: React.HTMLAttributes<HTMLDivElement>) => <div data-testid="skeleton" {...props} />,
}))

jest.mock("@/components/plugins/plugin-card", () => ({
  PluginCard: ({ plugin }: { plugin: { name: string } }) => <div>{plugin.name}</div>,
}))

jest.mock("@/components/plugins/permission-confirm-dialog", () => ({
  PermissionConfirmDialog: () => null,
}))

jest.mock("@/components/plugins/import-repo-dialog", () => ({
  ImportRepoDialog: () => <button type="button">import-repo</button>,
}))

jest.mock("@/components/plugins/skill-runtime-config-sheet", () => ({
  SkillRuntimeConfigSheet: () => null,
}))

const mockUsePluginMarket = usePluginMarket as jest.MockedFunction<typeof usePluginMarket>
const mockIsDesktopRuntime = isDesktopRuntime as jest.MockedFunction<typeof isDesktopRuntime>
const mockUseLocalSkillRuntimeStatuses =
  useLocalSkillRuntimeStatuses as jest.MockedFunction<typeof useLocalSkillRuntimeStatuses>

function createRuntimeStatus(
  overrides: Partial<LocalSkillRuntimeStatus> & Pick<LocalSkillRuntimeStatus, "skill_id" | "display_name">,
): LocalSkillRuntimeStatus {
  return {
    skill_id: overrides.skill_id,
    display_name: overrides.display_name,
    installed_version: overrides.installed_version ?? "1.0.0",
    is_enabled: overrides.is_enabled ?? true,
    execution_mode: overrides.execution_mode ?? "deeting_binding",
    ecosystem: overrides.ecosystem ?? "agentskills_compatible",
    adapter_kind: overrides.adapter_kind ?? "deeting_tool_binding",
    normalized_execution_surface: overrides.normalized_execution_surface ?? "desktop_capability",
    runnable_now: overrides.runnable_now ?? true,
    required_bins: overrides.required_bins ?? [],
    missing_bins: overrides.missing_bins ?? [],
    required_env: overrides.required_env ?? [],
    missing_env: overrides.missing_env ?? [],
    required_config: overrides.required_config ?? [],
    missing_config: overrides.missing_config ?? [],
    blocking_reason: overrides.blocking_reason ?? null,
    install_hints: overrides.install_hints ?? [],
    runtime_install_supported: overrides.runtime_install_supported ?? false,
    runtime_kind: overrides.runtime_kind ?? null,
    runtime_install_state: overrides.runtime_install_state ?? "unsupported",
    runtime_install_manager: overrides.runtime_install_manager ?? null,
    runtime_manager_available: overrides.runtime_manager_available ?? false,
    runtime_install_error: overrides.runtime_install_error ?? null,
    runtime_dependency_manifest_path: overrides.runtime_dependency_manifest_path ?? null,
    runtime_command_path: overrides.runtime_command_path ?? null,
    compatibility: overrides.compatibility ?? {},
    current_env: overrides.current_env ?? {},
    current_config: overrides.current_config ?? {},
  }
}

describe("PluginsClient store-only actions", () => {
  const mockMutate = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDesktopRuntime.mockReturnValue(true)
    mockUseLocalSkillRuntimeStatuses.mockReturnValue({
      runtimeStatuses: {},
      hasInstallingRuntime: false,
      refreshRuntimeStatuses: jest.fn(),
    })
    mockUsePluginMarket.mockReturnValue({
      plugins: [
        {
          id: "official.skills.memory",
          name: "Memory",
          description: "Built-in memory skill",
          status: "active",
          installed: true,
          source_kind: "official",
        },
        {
          id: "skill.find-skills",
          name: "Find Skills",
          description: "Locate available skills",
          status: "active",
          installed: true,
          source_kind: "community",
        },
      ],
      isLoading: false,
      isValidating: false,
      error: undefined,
      mutate: mockMutate,
    })
  })

  it.each([
    ["public plugins page", <PublicPluginsClient key="public-plugins-page" mode="market" />],
    ["dashboard plugins page", <DashboardPluginsClient key="dashboard-plugins-page" mode="market" />],
  ])("does not expose local maintenance actions from %s", (_label, view) => {
    render(view)

    expect(screen.queryByRole("button", { name: "page.syncAction" })).toBeNull()
    expect(screen.queryByRole("button", { name: "page.syncReinstallAction" })).toBeNull()
    expect(screen.queryByRole("button", { name: "page.repairIndexAction" })).toBeNull()
  })

  it.each([
    ["public market page", <PublicPluginsClient key="public-market-page" mode="market" />],
    ["dashboard installed page", <DashboardPluginsClient key="dashboard-installed-page" mode="installed" />],
  ])("hides official skills in %s", (_label, view) => {
    render(view)

    expect(screen.queryByText("Memory")).toBeNull()
    expect(screen.getByText("Find Skills")).toBeTruthy()
  })

  it.each([
    ["public installed page", <PublicPluginsClient key="public-installed-page" mode="installed" />],
    ["dashboard installed page", <DashboardPluginsClient key="dashboard-installed-view" mode="installed" />],
  ])("shows runtime-only local community skills in %s", (_label, view) => {
    mockUsePluginMarket.mockReturnValue({
      plugins: [
        {
          id: "official.skills.memory",
          name: "Memory",
          description: "Built-in memory skill",
          status: "active",
          installed: true,
          source_kind: "official",
        },
      ],
      isLoading: false,
      isValidating: false,
      error: undefined,
      mutate: mockMutate,
    })
    mockUseLocalSkillRuntimeStatuses.mockReturnValue({
      runtimeStatuses: {
        "tmp.path-probe": createRuntimeStatus({
          skill_id: "tmp.path-probe",
          display_name: "Path Probe",
        }),
        "official.skills.memory": createRuntimeStatus({
          skill_id: "official.skills.memory",
          display_name: "Memory",
        }),
      },
      hasInstallingRuntime: false,
      refreshRuntimeStatuses: jest.fn(),
    })

    render(view)

    expect(screen.getByText("Path Probe")).toBeTruthy()
    expect(screen.queryByText("Memory")).toBeNull()
  })
})
