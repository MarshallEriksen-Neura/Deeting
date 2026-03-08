import { fireEvent, render, screen } from "@testing-library/react"
import { CreditsAuditTabs } from "@/app/[locale]/dashboard/credits/components/credits-audit-tabs"

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock("@/app/[locale]/dashboard/credits/components/transaction-stream", () => ({
  TransactionStream: () => <div>transaction-stream-panel</div>,
}))

jest.mock("@/app/[locale]/dashboard/credits/components/recharge-history", () => ({
  RechargeHistory: () => <div>recharge-history-panel</div>,
}))

describe("CreditsAuditTabs", () => {
  it("shows spending view by default and switches to recharge history", () => {
    render(<CreditsAuditTabs />)

    expect(screen.getByText("transaction-stream-panel")).toBeInTheDocument()
    expect(screen.queryByText("recharge-history-panel")).not.toBeInTheDocument()

    const rechargeTab = screen.getByRole("tab", { name: "auditTabs.recharge" })
    fireEvent.mouseDown(rechargeTab)
    fireEvent.click(rechargeTab)

    expect(screen.getByText("recharge-history-panel")).toBeInTheDocument()
    expect(screen.queryByText("transaction-stream-panel")).not.toBeInTheDocument()
  })
})

