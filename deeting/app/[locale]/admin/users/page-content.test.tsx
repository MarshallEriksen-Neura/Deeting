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
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

jest.mock("./components/user-create-form", () => ({
  UserCreateForm: () => <div>user-create-form</div>,
}))

jest.mock("./components/user-filter-bar", () => ({
  UserFilterBar: () => <div>user-filter-bar</div>,
}))

jest.mock("./components/user-stats", () => ({
  UserStats: () => <div>user-stats</div>,
}))

describe("Admin users page", () => {
  beforeEach(() => {
    mockUseSWR.mockReset()
  })

  it("renders users from admin data", () => {
    mockUseSWR
      .mockReturnValueOnce({
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
      })
      .mockReturnValueOnce({
        data: null,
        error: null,
        isLoading: false,
        mutate: jest.fn(),
      })

    render(<PageContent />)

    expect(screen.getByText("user-stats")).toBeInTheDocument()
    expect(screen.getByText("user-create-form")).toBeInTheDocument()
    expect(screen.getByText("user-filter-bar")).toBeInTheDocument()
    expect(screen.getByText("alice")).toBeInTheDocument()
    expect(screen.getByText("alice@example.com")).toBeInTheDocument()
  })
})
