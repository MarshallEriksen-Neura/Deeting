import {
  LayoutDashboard,
  Route,
  Server,
  Plug,
  Key,
  Activity,
  Shield,
  Users,
  Settings,
  Bell,
  FileText,
  BarChart3,
  Cpu,
  Database,
  Lock,
  UserCog,
  type LucideIcon,
} from "lucide-react"

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
  /** Lucide icon component */
  icon: LucideIcon
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
        icon: LayoutDashboard,
      },
      {
        id: "routes",
        label: "nav.routes",
        href: "/dashboard/routes",
        icon: Route,
      },
      {
        id: "services",
        label: "nav.services",
        href: "/dashboard/services",
        icon: Server,
      },
      {
        id: "plugins",
        label: "nav.plugins",
        href: "/dashboard/plugins",
        icon: Plug,
      },
    ],
  },
  {
    title: "nav.configuration",
    items: [
      {
        id: "api-keys",
        label: "nav.apiKeys",
        href: "/dashboard/api-keys",
        icon: Key,
      },
      {
        id: "monitoring",
        label: "nav.monitoring",
        href: "/dashboard/monitoring",
        icon: Activity,
      },
      {
        id: "logs",
        label: "nav.logs",
        href: "/dashboard/logs",
        icon: FileText,
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
        icon: UserCog,
      },
      {
        id: "notifications",
        label: "nav.notifications",
        href: "/notifications",
        icon: Bell,
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
        icon: LayoutDashboard,
      },
      {
        id: "routes",
        label: "nav.routes",
        href: "/dashboard/routes",
        icon: Route,
      },
      {
        id: "services",
        label: "nav.services",
        href: "/dashboard/services",
        icon: Server,
      },
      {
        id: "plugins",
        label: "nav.plugins",
        href: "/dashboard/plugins",
        icon: Plug,
      },
    ],
  },
  {
    title: "nav.configuration",
    items: [
      {
        id: "api-keys",
        label: "nav.apiKeys",
        href: "/dashboard/api-keys",
        icon: Key,
      },
      {
        id: "monitoring",
        label: "nav.monitoring",
        href: "/dashboard/monitoring",
        icon: Activity,
      },
      {
        id: "logs",
        label: "nav.logs",
        href: "/dashboard/logs",
        icon: FileText,
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
        icon: BarChart3,
      },
      {
        id: "performance",
        label: "nav.performance",
        href: "/admin/performance",
        icon: Cpu,
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
        icon: Users,
      },
      {
        id: "roles",
        label: "nav.roles",
        href: "/admin/roles",
        icon: Shield,
      },
      {
        id: "security",
        label: "nav.security",
        href: "/admin/security",
        icon: Lock,
      },
      {
        id: "database",
        label: "nav.database",
        href: "/admin/database",
        icon: Database,
      },
      {
        id: "settings",
        label: "nav.settings",
        href: "/admin/settings",
        icon: Settings,
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
