import { defaultNavItems } from "@/components/layout/header/constants"
import {
  getRuntimeHeaderNavItems,
  shouldPrefetchHeaderNavLinks,
} from "@/components/layout/header/nav-runtime"

describe("defaultNavItems", () => {
  it("contains dashboard link for regular header navigation", () => {
    const hrefs = defaultNavItems.map((item) => item.href)
    expect(hrefs).toContain("/dashboard")
  })

  it("contains public docs link for regular header navigation", () => {
    const hrefs = defaultNavItems.map((item) => item.href)
    expect(hrefs).toContain("/docs")
  })

  it("does not expose admin entry by default", () => {
    const hrefs = defaultNavItems.map((item) => item.href)
    expect(hrefs).not.toContain("/admin")
  })

  it("temporarily hides plugin market from header navigation", () => {
    const hrefs = defaultNavItems.map((item) => item.href)
    expect(hrefs).not.toContain("/plugins/market")
  })

  it("temporarily hides images from header navigation", () => {
    const hrefs = defaultNavItems.map((item) => item.href)
    expect(hrefs).not.toContain("/gallery")
  })
})

describe("getRuntimeHeaderNavItems", () => {
  it("keeps only home, docs, and download on web", () => {
    const hrefs = getRuntimeHeaderNavItems(defaultNavItems, false).map((item) => item.href)

    expect(hrefs).toEqual(["/", "/docs", "/download"])
  })

  it("keeps desktop product navigation while hiding docs and download", () => {
    const hrefs = getRuntimeHeaderNavItems(defaultNavItems, true).map((item) => item.href)

    expect(hrefs).toContain("/chat")
    expect(hrefs).toContain("/mcp")
    expect(hrefs).toContain("/dashboard")
    expect(hrefs).not.toContain("/assistants")
    expect(hrefs).not.toContain("/docs")
    expect(hrefs).not.toContain("/download")
  })
})

describe("shouldPrefetchHeaderNavLinks", () => {
  it("keeps prefetch enabled on web", () => {
    expect(shouldPrefetchHeaderNavLinks(false)).toBe(true)
  })

  it("disables prefetch for desktop header links", () => {
    expect(shouldPrefetchHeaderNavLinks(true)).toBe(false)
  })
})
