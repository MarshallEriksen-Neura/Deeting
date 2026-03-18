import { getUserDashboardNavigation } from "../navigation-config"

function flattenNavIds(isDesktopRuntime: boolean) {
  return getUserDashboardNavigation({ isDesktopRuntime })
    .flatMap((group) => group.items)
    .map((item) => item.id)
}

describe("getUserDashboardNavigation", () => {
  it("keeps credits visible on web", () => {
    expect(flattenNavIds(false)).toContain("credits")
  })

  it("hides credits in desktop runtime", () => {
    expect(flattenNavIds(true)).not.toContain("credits")
  })
})
