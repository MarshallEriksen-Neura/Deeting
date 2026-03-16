import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { PageContent } from "./page-content"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useLocale: () => "en",
}))

const mockRunLocalMaintenanceAction = jest.fn()
const mockListLocalMaintenanceLogs = jest.fn()
const mockGetLocalCapabilityRegistryDiagnostics = jest.fn()
const mockUseSWR = jest.fn()

jest.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseSWR(...args),
}))

jest.mock("@/lib/api/desktop-config", () => ({
  isTauriRuntime: () => true,
}))

jest.mock("@/lib/api/desktop-system-assets", () => ({
  runLocalMaintenanceAction: (...args: unknown[]) => mockRunLocalMaintenanceAction(...args),
  listLocalMaintenanceLogs: (...args: unknown[]) => mockListLocalMaintenanceLogs(...args),
  getLocalCapabilityRegistryDiagnostics: (...args: unknown[]) =>
    mockGetLocalCapabilityRegistryDiagnostics(...args),
}))

jest.mock("@/components/admin", () => ({
  AdminStatusBadge: ({ text }: { text: string }) => <span>{text}</span>,
  AdminDataTable: ({ data }: { data: Array<{ id: string; message: string }> }) => (
    <div>{data.map((row) => <div key={row.id}>{row.message}</div>)}</div>
  ),
}))

jest.mock("@/components/ui/glass-card", () => ({
  GlassCard: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  AlertDialogAction: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe("Admin maintenance settings page", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseSWR.mockImplementation((key: string | null) => {
      if (key === "desktop-maintenance-history") {
        return {
          data: {
            total: 1,
            skip: 0,
            limit: 10,
            items: [
              {
                id: "log-1",
                kind: "sync_local_installs",
                status: "success",
                message: "sync complete",
                details: {
                  skill_install_fetched_count: 2,
                  skill_install_upserted_count: 2,
                  skill_failed_count: 0,
                },
                created_at: "2026-03-11T00:00:00Z",
              },
            ],
          },
          mutate: jest.fn(),
        }
      }

      if (key === "desktop-capability-registry-diagnostics") {
        return {
          data: {
            read_path_enabled: true,
            read_path_mode: "registry_first",
            legacy_control_plane_reads_enabled: false,
            current_generation: 4,
            total: 8,
            direct_callable_count: 5,
            source_kind_counts: [],
            memory_source_type_counts: [],
            asset_kind_counts: [],
            activation_state_counts: [],
            runtime_state_counts: [],
            search_index_state_counts: [],
            legacy_only_asset_count: 1,
            registry_first_only_asset_count: 0,
            migration_gaps: ["mcp"],
            legacy_only_assets: [
              {
                key: "skill_tool:skill.alpha::install",
                asset_id: "skill_binding::skill.alpha::install",
                name: "skill.skill.alpha.install",
                source_type: "user",
                asset_type: "skill_tool",
                package_id: "skill.alpha",
              },
            ],
            registry_first_only_assets: [],
            items: [],
          },
          mutate: jest.fn(),
        }
      }

      return { data: null, mutate: jest.fn() }
    })
  })

  it("only exposes repair action after cloud install sync removal", () => {
    render(<PageContent />)

    expect(screen.queryByRole("button", { name: "actions.syncAction" })).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "actions.syncReinstallAction" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "actions.repairIndexAction" })).toBeInTheDocument()
  })

  it("confirms before running full repair", async () => {
    mockRunLocalMaintenanceAction.mockResolvedValue({
      id: "log-3",
      kind: "repair_local_index",
      status: "success",
      message: "repair complete",
      details: {
        skill_reindexed_count: 3,
        assistant_reindexed_count: 2,
        sync: { assets_fetched: 4, skill_install_upserted_count: 4 },
      },
      created_at: "2026-03-11T00:00:02Z",
    })

    render(<PageContent />)
    fireEvent.click(screen.getByRole("button", { name: "actions.repairIndexAction" }))

    expect(screen.getByText("repairConfirm.title")).toBeInTheDocument()
    expect(mockRunLocalMaintenanceAction).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "repairConfirm.confirm" }))

    await waitFor(() => {
      expect(mockRunLocalMaintenanceAction).toHaveBeenCalledWith({ kind: "repair_local_index" })
    })
  })

  it("renders recent maintenance history", () => {
    render(<PageContent />)

    expect(screen.getByText("history.title")).toBeInTheDocument()
    expect(screen.getByText("sync complete")).toBeInTheDocument()
  })

  it("renders capability registry diagnostics", () => {
    render(<PageContent />)

    expect(screen.getByText("diagnostics.title")).toBeInTheDocument()
    expect(screen.getByText("diagnostics.readMode.registry_first")).toBeInTheDocument()
    expect(screen.getByText("diagnostics.migrationGaps.kind.mcp")).toBeInTheDocument()
    expect(screen.getByText("skill.skill.alpha.install")).toBeInTheDocument()
  })
})
