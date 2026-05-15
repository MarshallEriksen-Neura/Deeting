import { render, screen } from "@testing-library/react"
import { NextIntlClientProvider } from "next-intl"

import { loadStaticLocaleMessages } from "@/i18n/static-messages"

import { IslandApprovalCard } from "./island-approval-card"

describe("IslandApprovalCard zh-CN messages", () => {
  it("loads zh-CN island and approval messages together", async () => {
    const messages = await loadStaticLocaleMessages("zh-CN", {
      desktopExport: true,
      namespaces: ["common", "chat"],
    })

    render(
      <NextIntlClientProvider locale="zh-CN" messages={messages}>
        <IslandApprovalCard title="shell_execute" desc="desc" />
      </NextIntlClientProvider>,
    )

    expect(screen.getAllByText("等待审批").length).toBeGreaterThan(0)
    expect(screen.getByText("拒绝")).not.toBeNull()
    expect(screen.getByText("批准")).not.toBeNull()
  })
})
