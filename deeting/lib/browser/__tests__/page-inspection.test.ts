import { buildPageInspectionResult, isPageInspectionPrompt } from "@/lib/browser/page-inspection"

describe("buildPageInspectionResult", () => {
  it("extracts metrics, findings, and suggested next actions from a page snapshot", () => {
    const result = buildPageInspectionResult({
      url: "https://example.com/admin/orders",
      title: "Order Dashboard",
      documentReadyState: "complete",
      visibleText: `
        待处理 12
        失败 3
        告警 1
        订单 #1024 超时
      `,
      mainText: `
        Order dashboard
        待处理 12
        失败 3
        订单 #1024 超时
      `,
      headings: [{ level: 1, text: "订单面板" }],
      links: [{ text: "详情", href: "https://example.com/admin/orders/1024" }],
      buttons: [{ text: "刷新", disabled: false }],
      inputs: [{ placeholder: "搜索订单" }],
      forms: [],
    })

    expect(result.page).toMatchObject({
      title: "Order Dashboard",
      url: "https://example.com/admin/orders",
      module: "订单面板",
    })
    expect(result.keyMetrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Findings", value: "4" }),
      ])
    )
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "warning", text: "待处理 12" }),
        expect.objectContaining({ level: "critical", text: "失败 3" }),
      ])
    )
    expect(result.records[0]?.title).toContain("待处理")
    expect(result.nextActions).toHaveLength(3)
  })

  it("detects chat prompts that should trigger inspection mode", () => {
    expect(isPageInspectionPrompt("帮我巡检这个页面")).toBe(true)
    expect(isPageInspectionPrompt("inspect current page for anomalies")).toBe(true)
    expect(isPageInspectionPrompt("帮我写一封邮件")).toBe(false)
  })
})
