import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { PluginsClient as DashboardPluginsClient } from "@/app/[locale]/dashboard/plugins/components/plugins-client"
import { PluginsClient as PublicPluginsClient } from "@/app/[locale]/plugins/components/plugins-client"
import { repairLocalSystemAssetIndexFromCloud } from "@/lib/api/desktop-system-assets"
import { syncLocalSkillInstallsFromCloud, isDesktopRuntime } from "@/lib/api/plugin-market"
import { usePluginMarket } from "@/lib/swr/use-plugin-market"
import { toast } from "sonner"

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

jest.mock("@/lib/swr/use-plugin-market", () => ({
  usePluginMarket: jest.fn(),
}))

jest.mock("@/lib/api/plugin-market", () => ({
  installPlugin: jest.fn(),
  uninstallPlugin: jest.fn(),
  submitPluginRepo: jest.fn(),
  syncLocalSkillInstallsFromCloud: jest.fn(),
  isDesktopRuntime: jest.fn(),
  isUserVisiblePlugin: (plugin: { source_kind?: string }) => plugin.source_kind !== "official",
}))

jest.mock("@/lib/api/desktop-system-assets", () => ({
  repairLocalSystemAssetIndexFromCloud: jest.fn(),
}))

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    <button {...props}>{children}</button>,
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

const mockUsePluginMarket = usePluginMarket as jest.MockedFunction<typeof usePluginMarket>
const mockRepairLocalSystemAssetIndexFromCloud = repairLocalSystemAssetIndexFromCloud as jest.MockedFunction<
  typeof repairLocalSystemAssetIndexFromCloud
>
const mockSyncLocalSkillInstallsFromCloud = syncLocalSkillInstallsFromCloud as jest.MockedFunction<
  typeof syncLocalSkillInstallsFromCloud
>
const mockIsDesktopRuntime = isDesktopRuntime as jest.MockedFunction<typeof isDesktopRuntime>
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>

describe("PluginsClient desktop repair actions", () => {
  const mockMutate = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDesktopRuntime.mockReturnValue(true)
    mockSyncLocalSkillInstallsFromCloud.mockResolvedValue(null)
    mockRepairLocalSystemAssetIndexFromCloud.mockResolvedValue({
      vector_dimension: 1536,
      skill_reindexed_count: 3,
      assistant_reindexed_count: 2,
      sync: {
        fetched_count: 4,
        upserted_count: 4,
        hidden_count: 0,
        metadata_only_count: 0,
        executable_count: 4,
        archived_count: 0,
        skill_install_fetched_count: 1,
        skill_install_upserted_count: 1,
        skill_reinstalled_count: 0,
        skill_failed_count: 0,
        disabled_skill_count: 0,
        archived_assistant_count: 0,
        disabled_assistant_install_count: 0,
      },
    })
    mockUsePluginMarket.mockReturnValue({
      plugins: [
        {
          id: "official.skills.memory",
          name: "Memory",
          description: "Built-in memory skill",
          installed: true,
          source_kind: "official",
        },
        {
          id: "skill.find-skills",
          name: "Find Skills",
          description: "Locate available skills",
          installed: true,
          source_kind: "community",
        },
      ],
      isLoading: false,
      error: undefined,
      mutate: mockMutate,
    })
  })

  it.each([
    ["public plugins page", <PublicPluginsClient mode="market" />],
    ["dashboard plugins page", <DashboardPluginsClient mode="market" />],
  ])("confirms local index repair from %s", async (_label, view) => {
    render(view)

    fireEvent.click(screen.getByRole("button", { name: "page.repairIndexAction" }))

    expect(screen.getByText("repairConfirm.title")).toBeInTheDocument()
    expect(mockRepairLocalSystemAssetIndexFromCloud).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "repairConfirm.confirm" }))

    await waitFor(() => {
      expect(mockRepairLocalSystemAssetIndexFromCloud).toHaveBeenCalledTimes(1)
    })
    expect(mockMutate).toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenCalledWith("toast.repairSuccessTitle", {
      description:
        'toast.repairSuccessDesc:{"fetched":4,"upserted":4,"skills":3,"assistants":2}',
    })
  })

  it.each([
    ["public market page", <PublicPluginsClient mode="market" />],
    ["dashboard installed page", <DashboardPluginsClient mode="installed" />],
  ])("hides official skills in %s", (_label, view) => {
    render(view)

    expect(screen.queryByText("Memory")).not.toBeInTheDocument()
    expect(screen.getByText("Find Skills")).toBeInTheDocument()
  })
})
