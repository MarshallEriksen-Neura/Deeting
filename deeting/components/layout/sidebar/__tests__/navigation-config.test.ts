import { getUserDashboardNavigation, userNavigation } from "../navigation-config"

function matchesNavItem(
  item: (typeof userNavigation)[number]["items"][number],
  pathname: string
) {
  const href = item.href.split("?")[0]
  const matchMode = item.matchMode ?? "prefix"

  if (matchMode === "exact") {
    return pathname === href
  }

  return pathname === href || pathname.startsWith(`${href}/`)
}

function flattenNavIds(isDesktopRuntime: boolean) {
  return getUserDashboardNavigation({ isDesktopRuntime })
    .flatMap((group) => group.items)
    .map((item) => item.id)
}

function findNavItem(id: string) {
  return userNavigation
    .flatMap((group) => group.items)
    .find((item) => item.id === id)
}

describe("getUserDashboardNavigation", () => {
  it("keeps credits visible on web", () => {
    expect(flattenNavIds(false)).toContain("credits")
  })

  it("hides credits in desktop runtime", () => {
    expect(flattenNavIds(true)).not.toContain("credits")
  })

  it("shows task learning only in desktop runtime", () => {
    expect(flattenNavIds(true)).toContain("task-learning")
    expect(flattenNavIds(false)).not.toContain("task-learning")
  })

  it("keeps the dashboard overview item on exact matching so child routes do not double-highlight it", () => {
    const dashboardItem = findNavItem("dashboard")

    expect(dashboardItem).toBeDefined()
    expect(matchesNavItem(dashboardItem!, "/dashboard")).toBe(true)
    expect(matchesNavItem(dashboardItem!, "/dashboard/plugins")).toBe(false)
  })

  it("keeps non-root dashboard items active for their nested child routes", () => {
    const providersItem = findNavItem("providers")

    expect(providersItem).toBeDefined()
    expect(matchesNavItem(providersItem!, "/dashboard/user/providers")).toBe(true)
    expect(matchesNavItem(providersItem!, "/dashboard/user/providers/market")).toBe(true)
  })

  it("includes the dashboard security policy route", () => {
    const items = getUserDashboardNavigation({ isDesktopRuntime: true }).flatMap(
      (group) => group.items
    )

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "security-policy",
          href: "/dashboard/approval-rules",
          label: "nav.securityPolicy",
        }),
      ])
    )
  })

  it("includes the desktop llm wiki route in storage navigation", () => {
    const items = getUserDashboardNavigation({ isDesktopRuntime: true }).flatMap(
      (group) => group.items
    )

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "llm-wiki",
          href: "/dashboard/llm-wiki",
          label: "nav.llmWiki",
        }),
      ])
    )
  })
})
