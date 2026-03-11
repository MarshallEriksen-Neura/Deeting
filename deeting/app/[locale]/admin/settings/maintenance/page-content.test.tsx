import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { PageContent } from "./page-content"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}))

const mockSyncLocalSkillInstallsFromCloud = jest.fn()
const mockRepairLocalSystemAssetIndexFromCloud = jest.fn()

jest.mock("@/lib/api/desktop-config", () => ({
  isTauriRuntime: () => true,
}))

jest.mock("@/lib/api/plugin-market", () => ({
  syncLocalSkillInstallsFromCloud: (...args: unknown[]) => mockSyncLocalSkillInstallsFromCloud(...args),
}))

jest.mock("@/lib/api/desktop-system-assets", () => ({
  repairLocalSystemAssetIndexFromCloud: (...args: unknown[]) => mockRepairLocalSystemAssetIndexFromCloud(...args),
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
  })

  it("runs local install sync", async () => {
    mockSyncLocalSkillInstallsFromCloud.mockResolvedValue({ fetched_count: 2, upserted_count: 2, reinstalled_count: 0, failed_count: 0 })

    render(<PageContent />)
    fireEvent.click(screen.getByRole("button", { name: "actions.syncAction" }))

    await waitFor(() => {
      expect(mockSyncLocalSkillInstallsFromCloud).toHaveBeenCalledWith({ reinstallMissing: false, force: true })
    })
  })

  it("confirms before running full repair", async () => {
    mockRepairLocalSystemAssetIndexFromCloud.mockResolvedValue({
      vector_dimension: 1536,
      skill_reindexed_count: 3,
      assistant_reindexed_count: 2,
      sync: { fetched_count: 4, upserted_count: 4 },
    })

    render(<PageContent />)
    fireEvent.click(screen.getByRole("button", { name: "actions.repairIndexAction" }))

    expect(screen.getByText("repairConfirm.title")).toBeInTheDocument()
    expect(mockRepairLocalSystemAssetIndexFromCloud).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "repairConfirm.confirm" }))

    await waitFor(() => {
      expect(mockRepairLocalSystemAssetIndexFromCloud).toHaveBeenCalledTimes(1)
    })
  })
})