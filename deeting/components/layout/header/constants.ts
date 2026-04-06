import { NavItem } from "./types"

export const DEFAULT_LOGO = "/images/logo.svg"
export const DEFAULT_DESKTOP_LOGO = "/images/app-icon.svg"

export const defaultNavItems: NavItem[] = [
  { label: "home", href: "/" },
  { label: "chat", href: "/chat" },
  { label: "docs", href: "/docs" },
  { label: "mcp", href: "/mcp" },
  { label: "dashboard", href: "/dashboard" },
  { label: "download", href: "/download" },
]
