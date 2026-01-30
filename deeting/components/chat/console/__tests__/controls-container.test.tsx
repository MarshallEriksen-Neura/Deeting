import React from "react"
import { render, screen } from "@testing-library/react"
import ControlsContainer from "@/components/chat/console/controls-container"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams(""),
}))

jest.mock("@/i18n/routing", () => ({
  Link: ({
    children,
    scroll,
    ...props
  }: React.PropsWithChildren<{ scroll?: boolean } & Record<string, unknown>>) => (
    <a {...props}>{children}</a>
  ),
}))

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

describe("ControlsContainer (web)", () => {
  it("should hide assistant selector on web", () => {
    process.env.NEXT_PUBLIC_IS_TAURI = "false"
    render(<ControlsContainer />)
    expect(screen.queryByLabelText("hud.selectAgent")).toBeNull()
  })
})
