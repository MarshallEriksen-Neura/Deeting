import "@testing-library/jest-dom"
import { fireEvent, render, screen } from "@testing-library/react"
import PageInspectionResultPanel from "@/components/inspection/page-inspection-result-panel"
import { useChatStore } from "@/store/chat-store"

jest.mock("@/hooks/use-i18n", () => ({
  useI18n: () => (key: string) => key,
}))

describe("PageInspectionResultPanel", () => {
  beforeEach(() => {
    useChatStore.getState().setInput("")
  })

  it("fills the chat input when a suggested next action is clicked", () => {
    render(
      <PageInspectionResultPanel
        result={{
          page: {
            title: "Order Dashboard",
            url: "https://example.com/admin/orders",
            module: "订单面板",
          },
          summary: "Detected several actionable signals on the page.",
          keyMetrics: [{ label: "Findings", value: "2" }],
          findings: [{ level: "warning", text: "待处理 12" }],
          records: [{ title: "订单 #1024 超时", detail: "Detected from current page snapshot" }],
          nextActions: [
            {
              label: "Focus abnormal items",
              prompt: "继续定位这个页面里的异常项并展开详情",
            },
          ],
        }}
      />
    )

    fireEvent.click(screen.getByText("Focus abnormal items"))

    expect(useChatStore.getState().input).toBe("继续定位这个页面里的异常项并展开详情")
  })
})
