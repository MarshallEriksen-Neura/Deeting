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
}))

jest.mock("@/components/ui/glass-card", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("@/lib/api/admin-dashboard", () => ({
  fetchAdminProviderPresets: jest.fn(),
}))

describe("Admin provider presets page", () => {
  beforeEach(() => {
    mockUseSWR.mockReset()
  })

  it("renders provider preset cards from admin data", () => {
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
    expect(screen.getByText("openai")).toBeInTheDocument()
    expect(screen.getByText("https://api.openai.com")).toBeInTheDocument()
  })
})
