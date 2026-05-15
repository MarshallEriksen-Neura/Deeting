import React from "react"
import { render, screen } from "@testing-library/react"

import IslandLayout from "./layout"
import IslandPage from "./page"

const mockSetRequestLocale = jest.fn()
const mockLoadStaticLocaleMessages = jest.fn()
const mockNextIntlProvider = jest.fn(
  ({ children }: { children: React.ReactNode }) => <>{children}</>,
)

jest.mock("next-intl", () => ({
  NextIntlClientProvider: (props: { children: React.ReactNode }) =>
    mockNextIntlProvider(props),
}))

jest.mock("next-intl/server", () => ({
  setRequestLocale: (locale: string) => mockSetRequestLocale(locale),
}))

jest.mock("@/i18n/static-messages", () => ({
  loadStaticLocaleMessages: (...args: unknown[]) => mockLoadStaticLocaleMessages(...args),
}))

jest.mock("@/components/island/island-window-shell", () => ({
  IslandWindowShell: () => <div data-testid="island-window-shell" />,
}))

describe("island route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadStaticLocaleMessages.mockResolvedValue({
      common: { ok: "ok" },
      island: { title: "Island" },
    })
  })

  it("loads island route messages and keeps the transparent shell wrapper", async () => {
    const layout = await IslandLayout({
      children: <div data-testid="route-child" />,
      params: Promise.resolve({ locale: "en" }),
    })

    render(layout)

    expect(mockSetRequestLocale).toHaveBeenCalledWith("en")
    expect(mockLoadStaticLocaleMessages).toHaveBeenCalledWith("en", {
      desktopExport: true,
      namespaces: ["common", "island"],
    })
    expect(mockNextIntlProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: "en",
        messages: {
          common: { ok: "ok" },
          island: { title: "Island" },
        },
      }),
    )
    expect(document.querySelector("style")?.textContent).toContain(
      "background: transparent",
    )
    expect(screen.getByTestId("route-child")).not.toBeNull()
  })

  it("renders the standalone island window shell", () => {
    render(<IslandPage />)

    expect(screen.getByTestId("island-window-shell")).not.toBeNull()
  })
})

