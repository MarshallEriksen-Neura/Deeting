import { resolveModelVisual } from "@/components/models/model-picker"

describe("resolveModelVisual", () => {
  it("优先使用健康状态决定指示点颜色", () => {
    const visual = resolveModelVisual(
      { id: "Kimi-K2", owned_by: "moonshot" },
      { healthStatus: "healthy" }
    )

    expect(visual.indicator).toBe("bg-emerald-500")
  })

  it("无健康状态时，请求中使用蓝色作为会话态兜底", () => {
    const visual = resolveModelVisual(
      { id: "Kimi-K2", owned_by: "moonshot" },
      { isLoading: true, statusCode: "upstream.request.batch" }
    )

    expect(visual.indicator).toBe("bg-blue-500")
  })

  it("无健康和会话状态时，指示点保持灰色（不再依赖 owned_by）", () => {
    const visual = resolveModelVisual({ id: "gpt-4o", owned_by: "openai" })
    expect(visual.indicator).toBe("bg-black/30 dark:bg-white/30")
  })
})
