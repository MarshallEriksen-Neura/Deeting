import React from "react"
import { render, screen } from "@testing-library/react"
import { SettingsNav } from "../settings-nav"

function setNodeEnv(value: string | undefined) {
  Reflect.set(process.env, "NODE_ENV", value)
}

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

describe("SettingsNav browser section visibility", () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalBrowserPanelFlag =
    process.env.NEXT_PUBLIC_ENABLE_BROWSER_AGENT_PANEL

  afterEach(() => {
    setNodeEnv(originalNodeEnv)
    if (originalBrowserPanelFlag === undefined) {
      delete process.env.NEXT_PUBLIC_ENABLE_BROWSER_AGENT_PANEL
    } else {
      process.env.NEXT_PUBLIC_ENABLE_BROWSER_AGENT_PANEL =
        originalBrowserPanelFlag
    }
  })

  it("hides the browser nav item in production when the panel flag is off", () => {
    setNodeEnv("production")
    delete process.env.NEXT_PUBLIC_ENABLE_BROWSER_AGENT_PANEL

    render(
      <SettingsNav
        activeSection="models"
        onSectionChange={jest.fn()}
        isTauriRuntime
      />
    )

    expect(screen.queryByText("nav.browser")).not.toBeInTheDocument()
  })

  it("shows the browser nav item in production when the panel flag is on", () => {
    setNodeEnv("production")
    process.env.NEXT_PUBLIC_ENABLE_BROWSER_AGENT_PANEL = "true"

    render(
      <SettingsNav
        activeSection="models"
        onSectionChange={jest.fn()}
        isTauriRuntime
      />
    )

    expect(screen.getAllByText("nav.browser")).not.toHaveLength(0)
  })

  it("does not show the approval rules nav item in desktop runtime", () => {
    render(
      <SettingsNav
        activeSection="agent"
        onSectionChange={jest.fn()}
        isTauriRuntime
      />
    )

    expect(screen.queryByText("审批规则")).not.toBeInTheDocument()
  })
})
