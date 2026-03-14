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
const mockRunScanReviewActions = jest.fn()

jest.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseSWR(...args),
}))

jest.mock("@/lib/api/desktop-config", () => ({
  isTauriRuntime: () => true,
}))

jest.mock("@/lib/api/local-scan", () => ({
  runScanReviewAction: (...args: unknown[]) => mockRunScanReviewAction(...args),
  runScanReviewActions: (...args: unknown[]) => mockRunScanReviewActions(...args),
  scanDirectoryReview: jest.fn(),
}))

jest.mock("@/components/admin", () => ({
  AdminStatCards: () => <div>stats</div>,
  AdminStatusBadge: ({ text }: { text: string }) => <span>{text}</span>,
  AdminFilterBar: ({
    actions,
    filters = [],
    onFilterChange,
  }: {
    actions?: React.ReactNode
    filters?: Array<{
      key: string
      options?: Array<{ label: string; value: string }>
    }>
    onFilterChange?: (key: string, value: string) => void
  }) => (
    <div>
      {filters.flatMap((filter) =>
        (filter.options ?? []).map((option) => (
          <button
            key={`${filter.key}-${option.value}`}
            type="button"
            onClick={() => onFilterChange?.(filter.key, option.value)}
          >
            {option.label}
          </button>
        ))
      )}
      {actions}
    </div>
  ),
  AdminDataTable: ({
    data,
    columns = [],
    rowActions,
  }: {
    data: Array<{ id: string }>
    columns?: Array<{ key: string; render?: (row: { id: string }) => React.ReactNode }>
    rowActions?: (row: { id: string }) => React.ReactNode
  }) => (
    <div>
      {data.map((row) => (
        <div key={row.id}>
          {columns.map((column) => (
            <div key={`${row.id}-${column.key}`}>{column.render?.(row) ?? null}</div>
          ))}
          {rowActions?.(row)}
        </div>
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
  summary: { document_count: 1, finding_count: 1, warning_count: 1, error_count: 0, skill_bundle_count: 1, index_missing_count: 1, install_missing_count: 0, security_warning_count: 1, high_risk_script_count: 0, missing_skill_doc_count: 0 },
  documents: [],
  findings: [{
    id: "finding-1",
    severity: "warn",
    code: "asset_index_missing",
    message: "Index missing",
    bundle_id: "skill.find-skills",
    document_path: "/tmp/skills/skill.find-skills/SKILL.md",
    metadata: {
      adapter_kind: "openclaw_script",
      normalized_execution_surface: "script_runner",
      ecosystem: "openclaw_agentskills",
      risk_level: "medium",
      operation_class: "network_read",
      target_class: "public_internet",
      boundary_class: "soft_boundary",
    },
    action: { kind: "reindex_bundle", bundle_id: "skill.find-skills", path: "/tmp/skills/skill.find-skills" },
  }],
}

describe("Dashboard scan reviews page", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseSWR.mockReturnValue({ data: mockRun, error: undefined, isLoading: false, isValidating: false, mutate: mockMutate })
  })

  it("runs finding actions from the scan table", async () => {
    mockRunScanReviewAction.mockResolvedValue({ status: "applied", message: "Action applied" })

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

  it("runs batch fix for all actionable findings", async () => {
    mockRunScanReviewActions.mockResolvedValue({ total: 1, applied: 1, failed: 0, skipped: 0, results: [] })

    render(<PageContent />)
    fireEvent.click(screen.getByRole("button", { name: "actions.fixAll" }))

    await waitFor(() => {
      expect(mockRunScanReviewActions).toHaveBeenCalledWith([
        {
          kind: "reindex_bundle",
          bundle_id: "skill.find-skills",
          path: "/tmp/skills/skill.find-skills",
        },
      ])
    })
    expect(mockMutate).toHaveBeenCalled()
  })

  it("does not expose global maintenance buttons here anymore", () => {
    render(<PageContent />)

    expect(screen.queryByRole("button", { name: "actions.syncAction" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "actions.syncReinstallAction" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "actions.repairIndexAction" })).not.toBeInTheDocument()
  })

  it("renders structured risk metadata from scan findings", () => {
    mockUseSWR.mockReturnValue({
      data: {
        ...mockRun,
        documents: [
          {
            id: "doc-1",
            path: "/tmp/skills/skill.find-skills",
            relative_path: "skill.find-skills",
            document_kind: "skill_bundle",
            display_name: "Find Skills",
            bundle_id: "skill.find-skills",
            status: "needs_review",
            size_bytes: null,
            modified_at: null,
            sha256: null,
            excerpt: "Bundle summary",
            metadata: {
              adapter_kind: "openclaw_script",
              normalized_execution_surface: "script_runner",
              ecosystem: "openclaw_agentskills",
              risk_preview: {
                risk_level: "medium",
                operation_class: "network_read",
                target_class: "unknown",
                boundary_class: "soft_boundary",
              },
            },
          },
        ],
      },
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: mockMutate,
    })

    render(<PageContent />)

    expect(
      screen.getAllByText(
        'executionSurface.script_runner · adapterKind.openclaw_script · openclaw_agentskills'
      )
    ).toHaveLength(2)
    expect(screen.getByText("medium · network_read · soft_boundary")).toBeInTheDocument()
    expect(screen.getByText("medium · network_read · public_internet · soft_boundary")).toBeInTheDocument()
  })

  it("filters findings by boundary class", () => {
    mockUseSWR.mockReturnValue({
      data: {
        ...mockRun,
        findings: [
          mockRun.findings[0],
          {
            ...mockRun.findings[0],
            id: "finding-2",
            code: "runtime_scripts_detected",
            message: "Runtime script",
            metadata: {
              risk_level: "high",
              operation_class: "process_exec",
              target_class: "host",
              boundary_class: "hard_boundary",
            },
            action: undefined,
          },
        ],
      },
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: mockMutate,
    })

    render(<PageContent />)
    fireEvent.click(screen.getByRole("button", { name: "boundary.hard_boundary" }))

    expect(screen.getByText("Runtime script")).toBeInTheDocument()
    expect(screen.queryByText("Index missing")).not.toBeInTheDocument()
  })

  it("filters findings by operation class", () => {
    mockUseSWR.mockReturnValue({
      data: {
        ...mockRun,
        findings: [
          mockRun.findings[0],
          {
            ...mockRun.findings[0],
            id: "finding-3",
            code: "script_file_detected",
            message: "Shell script",
            metadata: {
              risk_level: "high",
              operation_class: "process_exec",
              target_class: "host",
              boundary_class: "hard_boundary",
            },
            action: undefined,
          },
        ],
      },
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: mockMutate,
    })

    render(<PageContent />)
    fireEvent.click(screen.getByRole("button", { name: "operation.process_exec" }))

    expect(screen.getByText("Shell script")).toBeInTheDocument()
    expect(screen.queryByText("Index missing")).not.toBeInTheDocument()
  })
})
