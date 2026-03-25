import React from "react"
import { render, screen } from "@testing-library/react"

import { PageContent } from "./page-content"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

const mockUseSWR = jest.fn()

jest.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseSWR(...args),
}))

jest.mock("@/components/admin", () => ({
  AdminStatusBadge: ({ text }: { text: string }) => <span>{text}</span>,
  AdminStatCards: () => <div>stats</div>,
  AdminFilterBar: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div>,
  AdminDataTable: ({
    columns,
    data,
    rowActions,
  }: {
    columns: Array<{ key: string; render?: (row: any, index: number) => React.ReactNode }>
    data: any[]
    rowActions?: (row: any) => React.ReactNode
  }) => (
    <div>
      {data.map((row, index) => (
        <div key={row.id ?? index}>
          {columns.map((column) => (
            <div key={column.key}>
              {column.render ? column.render(row, index) : row[column.key]}
            </div>
          ))}
          {rowActions ? rowActions(row) : null}
        </div>
      ))}
    </div>
  ),
  getStatusTone: () => "success",
}))

jest.mock("@/components/ui/glass-card", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    asChild,
    ...props
  }: React.PropsWithChildren<{ asChild?: boolean } & Record<string, unknown>>) =>
    asChild ? <>{children}</> : <button {...props}>{children}</button>,
}))

jest.mock("@/lib/api/admin-dashboard", () => ({
  fetchAdminProviderPresets: jest.fn(),
  deleteAdminProviderPreset: jest.fn(),
}))

describe("Admin provider presets page", () => {
  beforeEach(() => {
    mockUseSWR.mockReset()
  })

  it("renders provider preset console entries and create action", () => {
    mockUseSWR.mockReturnValue({
      data: [
        {
          id: "preset-1",
          name: "OpenAI",
          slug: "openai",
          provider: "openai",
          category: "Cloud API",
          base_url: "https://api.openai.com",
          is_active: true,
        },
      ],
      error: null,
      isLoading: false,
    })

    render(<PageContent />)

    expect(screen.getByText("OpenAI")).toBeInTheDocument()
    expect(screen.getAllByText("openai").length).toBeGreaterThan(0)
    expect(screen.getByText("https://api.openai.com")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "actions.create" })).toHaveAttribute(
      "href",
      "/admin/provider-presets/new"
    )
    expect(screen.getByRole("link", { name: "actions.edit" })).toHaveAttribute(
      "href",
      "/admin/provider-presets/openai"
    )
  })
})
