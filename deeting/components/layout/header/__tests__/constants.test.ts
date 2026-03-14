import { defaultNavItems } from "@/components/layout/header/constants"

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
})
