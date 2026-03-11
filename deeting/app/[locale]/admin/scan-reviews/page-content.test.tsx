import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { PageContent } from "./page-content"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useLocale: () => "en",
}))

const mockMutate = jest.fn()
const mockUseSWR = jest.fn()
const mockRunScanReviewAction = jest.fn()

jest.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseSWR(...args),
}))

jest.mock("@/lib/api/desktop-config", () => ({
  isTauriRuntime: () => true,
}))

jest.mock("@/lib/api/local-scan", () => ({
  runScanReviewAction: (...args: unknown[]) => mockRunScanReviewAction(...args),
  scanDirectoryReview: jest.fn(),
}))

jest.mock("@/components/admin", () => ({
  AdminStatCards: () => <div>stats</div>,
  AdminStatusBadge: ({ text }: { text: string }) => <span>{text}</span>,
  AdminFilterBar: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div>,
  AdminDataTable: ({ data, rowActions }: { data: Array<{ id: string }>; rowActions?: (row: { id: string }) => React.ReactNode }) => (
    <div>
      {data.map((row) => (
        <div key={row.id}>{rowActions?.(row)}</div>
      ))}
    </div>
  ),
}))

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

const mockRun = {
  run_id: "run-1",
  trigger: "manual",
  target_kind: "directory",
  target_path: "/tmp/skills",
  started_at: "2026-03-11T00:00:00Z",
  finished_at: "2026-03-11T00:00:01Z",
  summary: { document_count: 1, finding_count: 1, warning_count: 1, error_count: 0, skill_bundle_count: 1, index_missing_count: 1, install_missing_count: 0 },
  documents: [],
  findings: [{
    id: "finding-1",
    severity: "warn",
    code: "asset_index_missing",
    message: "Index missing",
    bundle_id: "skill.find-skills",
    document_path: "/tmp/skills/skill.find-skills/SKILL.md",
    action: { kind: "reindex_bundle", bundle_id: "skill.find-skills", path: "/tmp/skills/skill.find-skills" },
  }],
}

describe("Scan reviews page", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseSWR.mockReturnValue({ data: mockRun, error: undefined, isLoading: false, isValidating: false, mutate: mockMutate })
  })

  it("runs finding actions from the scan table", async () => {
    mockRunScanReviewAction.mockResolvedValue({ success: true, message: "Action applied" })

    render(<PageContent />)
    fireEvent.click(screen.getByRole("button", { name: "actions.reindex_bundle" }))

    await waitFor(() => {
      expect(mockRunScanReviewAction).toHaveBeenCalledWith({
        kind: "reindex_bundle",
        bundle_id: "skill.find-skills",
        path: "/tmp/skills/skill.find-skills",
      })
    })
    expect(mockMutate).toHaveBeenCalled()
  })

  it("does not expose global maintenance buttons here anymore", () => {
    render(<PageContent />)

    expect(screen.queryByRole("button", { name: "actions.syncAction" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "actions.syncReinstallAction" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "actions.repairIndexAction" })).not.toBeInTheDocument()
  })
})