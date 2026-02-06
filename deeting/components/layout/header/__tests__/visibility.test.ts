import { shouldHideGlobalHeader } from "@/components/layout/header/visibility"

describe("shouldHideGlobalHeader", () => {
  it.each([
    "/chat",
    "/chat/select-agent",
    "/spec-agent",
    "/video",
    "/en/chat",
    "/en/spec-agent",
    "/zh-CN/video",
  ])("hides header on %s", (pathname) => {
    expect(shouldHideGlobalHeader(pathname)).toBe(true)
  })

  it.each([
    null,
    "/",
    "/dashboard",
    "/videos",
    "/en/videos",
    "/zh-CN/dashboard",
  ])("does not hide header on %s", (pathname) => {
    expect(shouldHideGlobalHeader(pathname)).toBe(false)
  })
})
