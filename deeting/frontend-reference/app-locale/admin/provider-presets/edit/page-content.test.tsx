import React from "react"
import { render, screen } from "@testing-library/react"
import { PageContent } from "./page-content"

const mockUseSearchParams = jest.fn()

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockUseSearchParams(),
}))

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("@/components/ui/glass-card", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock("../components/preset-editor-console", () => ({
  PresetEditorConsole: ({ slug }: { slug: string }) => <div>editor:{slug}</div>,
}))

describe("Provider preset edit page", () => {
  beforeEach(() => {
    mockUseSearchParams.mockReset()
  })

  it("renders the editor when the slug query is present", () => {
    mockUseSearchParams.mockReturnValue({
      get: (key: string) => (key === "slug" ? "openai" : null),
    })

    render(<PageContent />)

    expect(screen.getByText("editor:openai")).toBeInTheDocument()
  })

  it("renders an error when the slug query is missing", () => {
    mockUseSearchParams.mockReturnValue({
      get: () => null,
    })

    render(<PageContent />)

    expect(screen.getByText("feedback.loadFailed")).toBeInTheDocument()
  })
})
