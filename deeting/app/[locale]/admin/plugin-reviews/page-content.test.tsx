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
const mockApproveAdminPluginReview = jest.fn()
const mockRejectAdminPluginReview = jest.fn()

jest.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseSWR(...args),
}))

jest.mock("@/lib/api/admin-dashboard", () => ({
  fetchAdminPluginMarketReviews: jest.fn(),
  approveAdminPluginReview: (...args: unknown[]) => mockApproveAdminPluginReview(...args),
  rejectAdminPluginReview: (...args: unknown[]) => mockRejectAdminPluginReview(...args),
}))

jest.mock("@/components/admin", () => ({
  AdminStatCards: () => <div>stats</div>,
  AdminFilterBar: () => <div>filters</div>,
  AdminStatusBadge: ({ text }: { text: string }) => <span>{text}</span>,
  getStatusTone: () => "default",
  AdminDataTable: ({ data, rowActions }: { data: Array<{ id: string; name: string; status?: string }>; rowActions?: (row: { id: string; name: string; status?: string }) => React.ReactNode }) => (
    <div>
      {data.map((row) => (
        <div key={row.id}>
          <span>{row.name}</span>
          {rowActions?.(row)}
        </div>
      ))}
    </div>
  ),
}))

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open?: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}))

jest.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
}))

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

describe("Plugin reviews page", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUseSWR.mockReturnValue({
      data: {
        items: [
          {
            id: "skill.http.fetch",
            name: "HTTP Fetch",
            status: "needs_review",
            risk_level: "high",
            source_repo: "https://github.com/example/http-fetch",
            source_revision: "abc123",
            submitter_user_id: "00000000-0000-0000-0000-000000000010",
            security_review_summary: "Calls external API",
            network_targets: ["api.example.com"],
            destructive_actions: ["writes files"],
            privacy_risks: ["reads personal data"],
            findings: [{ category: "network", message: "Calls external API" }],
            reviewed_at: null,
            review_reason: null,
          },
        ],
      },
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    })
  })

  it("renders plugin rows and approves a pending review", async () => {
    mockApproveAdminPluginReview.mockResolvedValue({ status: "active" })

    render(<PageContent />)

    expect(screen.getByText("HTTP Fetch")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "actions.approve" }))

    await waitFor(() => {
      expect(mockApproveAdminPluginReview).toHaveBeenCalledWith("skill.http.fetch")
    })
    expect(mockMutate).toHaveBeenCalled()
  })

  it("requires a reject reason before submitting", async () => {
    mockRejectAdminPluginReview.mockResolvedValue({ status: "rejected" })

    render(<PageContent />)

    fireEvent.click(screen.getByRole("button", { name: "actions.reject" }))
    fireEvent.change(screen.getByLabelText("dialog.reasonLabel"), {
      target: { value: "unsafe file writes" },
    })
    fireEvent.click(screen.getByRole("button", { name: "dialog.confirmReject" }))

    await waitFor(() => {
      expect(mockRejectAdminPluginReview).toHaveBeenCalledWith(
        "skill.http.fetch",
        "unsafe file writes"
      )
    })
  })

  it("opens the detail drawer for a review", () => {
    render(<PageContent />)

    fireEvent.click(screen.getByRole("button", { name: "actions.details" }))

    expect(screen.getByText("drawer.sections.findings")).toBeInTheDocument()
    expect(screen.getByText("network")).toBeInTheDocument()
    expect(screen.getByText("api.example.com")).toBeInTheDocument()
  })
})

