import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { PluginsClient as DashboardPluginsClient } from "@/app/[locale]/dashboard/plugins/components/plugins-client"
import { PluginsClient as PublicPluginsClient } from "@/app/[locale]/plugins/components/plugins-client"
import { isDesktopRuntime } from "@/lib/api/plugin-market"
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

jest.mock("@/lib/swr/use-plugin-market", () => ({
  usePluginMarket: jest.fn(),
}))

jest.mock("@/lib/api/plugin-market", () => ({
  installPlugin: jest.fn(),
  uninstallPlugin: jest.fn(),
  submitPluginRepo: jest.fn(),
  isDesktopRuntime: jest.fn(),
  isUserVisiblePlugin: (plugin: { source_kind?: string }) => plugin.source_kind !== "official",
}))

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) =>
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
const mockIsDesktopRuntime = isDesktopRuntime as jest.MockedFunction<typeof isDesktopRuntime>

describe("PluginsClient store-only actions", () => {
  const mockMutate = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDesktopRuntime.mockReturnValue(true)
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
  ])("does not expose local maintenance actions from %s", (_label, view) => {
    render(view)

    expect(screen.queryByRole("button", { name: "page.syncAction" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "page.syncReinstallAction" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "page.repairIndexAction" })).not.toBeInTheDocument()
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
