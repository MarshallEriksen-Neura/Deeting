import { type IconName } from "./icon-map"

/**
 * Navigation Item Interface
 */
export interface NavItem {
  /** Unique identifier */
  id: string
  /** Display label (i18n key) */
  label: string
  /** Navigation path */
  href: string
  /** Icon name mapped to actual component on client */
  icon: IconName
  /** Badge count (optional) */
  badge?: number
  /** Whether this item is disabled */
  disabled?: boolean
  /** Sub-items for nested navigation */
  children?: NavItem[]
}

/**
 * Navigation Group Interface
 */
export interface NavGroup {
  /** Group title (i18n key) */
  title: string
  /** Navigation items in this group */
  items: NavItem[]
}

/**
 * User Navigation Configuration
 *
 * Navigation items visible to regular users
 */
export const userNavigation: NavGroup[] = [
  {
    title: "nav.main",
    items: [
      {
        id: "dashboard",
        label: "nav.dashboard",
        href: "/dashboard",
        icon: "layoutDashboard",
      },
      {
        id: "routes",
        label: "nav.routes",
        href: "/dashboard/routes",
        icon: "route",
      },
      {
        id: "services",
        label: "nav.services",
        href: "/dashboard/services",
        icon: "server",
      },
      {
        id: "plugins",
        label: "nav.plugins",
        href: "/dashboard/plugins",
        icon: "plug",
      },
    ],
  },
  {
    title: "nav.configuration",
    items: [
      {
        id: "providers",
        label: "nav.providers",
        href: "/dashboard/user/providers",
        icon: "cpu",
      },
      {
        id: "api-keys",
        label: "nav.apiKeys",
        href: "/dashboard/user/api-keys",
        icon: "key",
      },
      {
        id: "monitoring",
        label: "nav.monitoring",
        href: "/dashboard/monitoring",
        icon: "activity",
      },
      {
        id: "logs",
        label: "nav.logs",
        href: "/dashboard/logs",
        icon: "fileText",
      },
    ],
  },
  {
    title: "nav.account",
    items: [
      {
        id: "profile",
        label: "nav.profile",
        href: "/profile",
        icon: "userCog",
      },
      {
        id: "notifications",
        label: "nav.notifications",
        href: "/notifications",
        icon: "bell",
        badge: 3,
      },
    ],
  },
]

/**
 * Admin Navigation Configuration
 *
 * Navigation items visible to administrators
 * Includes all user items plus admin-specific sections
 */
export const adminNavigation: NavGroup[] = [
  {
    title: "nav.main",
    items: [
      {
        id: "dashboard",
        label: "nav.dashboard",
        href: "/dashboard",
        icon: "layoutDashboard",
      },
      {
        id: "routes",
        label: "nav.routes",
        href: "/dashboard/routes",
        icon: "route",
      },
      {
        id: "services",
        label: "nav.services",
        href: "/dashboard/services",
        icon: "server",
      },
      {
        id: "plugins",
        label: "nav.plugins",
        href: "/dashboard/plugins",
        icon: "plug",
      },
    ],
  },
  {
    title: "nav.configuration",
    items: [
      {
        id: "providers",
        label: "nav.providers",
        href: "/dashboard/user/providers",
        icon: "cpu",
      },
      {
        id: "api-keys",
        label: "nav.apiKeys",
        href: "/dashboard/user/api-keys",
        icon: "key",
      },
      {
        id: "monitoring",
        label: "nav.monitoring",
        href: "/dashboard/monitoring",
        icon: "activity",
      },
      {
        id: "logs",
        label: "nav.logs",
        href: "/dashboard/logs",
        icon: "fileText",
      },
    ],
  },
  {
    title: "nav.analytics",
    items: [
      {
        id: "statistics",
        label: "nav.statistics",
        href: "/admin/statistics",
        icon: "barChart3",
      },
      {
        id: "performance",
        label: "nav.performance",
        href: "/admin/performance",
        icon: "cpu",
      },
    ],
  },
  {
    title: "nav.system",
    items: [
      {
        id: "users",
        label: "nav.users",
        href: "/admin/users",
        icon: "users",
      },
      {
        id: "roles",
        label: "nav.roles",
        href: "/admin/roles",
        icon: "shield",
      },
      {
        id: "security",
        label: "nav.security",
        href: "/admin/security",
        icon: "lock",
      },
      {
        id: "database",
        label: "nav.database",
        href: "/admin/database",
        icon: "database",
      },
      {
        id: "settings",
        label: "nav.settings",
        href: "/admin/settings",
        icon: "settings",
      },
    ],
  },
]

/**
 * Get navigation config by role
 */
export function getNavigationByRole(role: "admin" | "user"): NavGroup[] {
  return role === "admin" ? adminNavigation : userNavigation
}
