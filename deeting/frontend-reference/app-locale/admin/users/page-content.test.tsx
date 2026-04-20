import React from "react"
import { render, screen } from "@testing-library/react"

import { PageContent } from "./page-content"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useLocale: () => "en",
}))

const mockUseSWR = jest.fn()

jest.mock("swr", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseSWR(...args),
}))

jest.mock("@/components/admin", () => ({
  AdminStatCards: () => <div>stats</div>,
  AdminFilterBar: () => <div>filters</div>,
  AdminDataTable: ({
    data,
    columns = [],
  }: {
    data: Array<Record<string, unknown>>
    columns?: Array<{ key: string; render?: (row: Record<string, unknown>) => React.ReactNode }>
  }) => (
    <div>
      {data.map((row) => (
        <div key={String(row.id)}>
          {columns.map((column) => (
            <div key={`${String(row.id)}-${column.key}`}>
              {column.render ? column.render(row) : String(row[column.key] ?? "")}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
  AdminStatusBadge: ({ text }: { text: string }) => <span>{text}</span>,
  getStatusTone: () => "success",
}))

jest.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    asChild,
    ...props
  }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }>) =>
    asChild ? <>{children}</> : <button {...props}>{children}</button>,
}))

describe("Admin users page", () => {
  beforeEach(() => {
    mockUseSWR.mockReset()
  })

  it("renders users from admin data", () => {
    mockUseSWR.mockImplementation((key: unknown) => {
      if (key === "/api/v1/admin/users?limit=100") {
        return {
          data: {
            items: [
              {
                id: "user-1",
                username: "alice",
                email: "alice@example.com",
                is_active: true,
                is_superuser: false,
                created_at: "2026-03-25T00:00:00Z",
                updated_at: "2026-03-25T00:00:00Z",
              },
            ],
          },
          error: null,
          isLoading: false,
          mutate: jest.fn(),
        }
      }
      return {
        data: {
          items: [],
        },
        error: null,
        isLoading: false,
        mutate: jest.fn(),
      }
    })

    render(<PageContent />)

    expect(screen.getByText("stats")).toBeInTheDocument()
    expect(screen.getByText("filters")).toBeInTheDocument()
    expect(screen.getByText("alice")).toBeInTheDocument()
    expect(screen.getByText("alice@example.com")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "actions.createUser" })).toBeInTheDocument()
  })
})
