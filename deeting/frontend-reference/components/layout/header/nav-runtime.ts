import type { NavItem } from "./types"

const WEB_ONLY_HEADER_HREFS = new Set(["/", "/docs", "/download"])
const DESKTOP_HIDDEN_HEADER_HREFS = new Set(["/docs", "/download"])

export function getRuntimeHeaderNavItems(navItems: NavItem[], isTauri: boolean): NavItem[] {
  if (isTauri) {
    return navItems.filter((item) => !DESKTOP_HIDDEN_HEADER_HREFS.has(item.href))
  }

  return navItems.filter((item) => WEB_ONLY_HEADER_HREFS.has(item.href))
}

export function shouldPrefetchHeaderNavLinks(isTauri: boolean) {
  return !isTauri
}
