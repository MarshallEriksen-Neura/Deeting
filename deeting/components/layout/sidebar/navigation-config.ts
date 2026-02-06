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
        id: "credits",
        label: "nav.credits",
        href: "/dashboard/credits",
        icon: "coins",
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
    title: "nav.storage",
    items: [
      {
        id: "knowledge",
        label: "nav.knowledge",
        href: "/dashboard/knowledge",
        icon: "folderOpen",
      },
    ],
  },
  {
    title: "nav.account",
    items: [
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
 * Structure based on design doc: 2026-02-01-admin-sidebar-navigation-design.md
 * Mental model: "看什么→管什么→改什么"
 */
export const adminNavigation: NavGroup[] = [
  // 1) 概览
  {
    title: "nav.overview",
    items: [
      {
        id: "admin-dashboard",
        label: "nav.adminDashboard",
        href: "/admin",
        icon: "layoutDashboard",
      },
    ],
  },
  // 2) 监控
  {
    title: "nav.monitoring",
    items: [
      {
        id: "admin-monitoring",
        label: "nav.adminMonitoring",
        href: "/admin/monitoring",
        icon: "eye",
      },
    ],
  },
  // 3) 内容与知识
  {
    title: "nav.contentKnowledge",
    items: [
      {
        id: "assistant-management",
        label: "nav.assistantManagement",
        href: "/admin/assistants",
        icon: "sparkles",
      },
      {
        id: "assistant-reviews",
        label: "nav.assistantReviews",
        href: "/admin/assistant-reviews",
        icon: "checkSquare",
      },
      {
        id: "spec-knowledge",
        label: "nav.specKnowledge",
        href: "/admin/spec-knowledge-candidates",
        icon: "tags",
      },
      {
        id: "knowledge-reviews",
        label: "nav.knowledgeReviews",
        href: "/admin/knowledge/reviews",
        icon: "bookOpen",
      },
    ],
  },
  // 4) 访问与安全
  {
    title: "nav.accessSecurity",
    items: [
      {
        id: "user-management",
        label: "nav.userManagement",
        href: "/admin/users",
        icon: "userCheck",
      },
      {
        id: "admin-api-keys",
        label: "nav.adminApiKeys",
        href: "/admin/api-keys",
        icon: "keyRound",
      },
      {
        id: "api-rate-limit",
        label: "nav.apiRateLimit",
        href: "/admin/api-keys/rate-limit",
        icon: "gauge",
      },
      {
        id: "registration",
        label: "nav.registration",
        href: "/admin/registration",
        icon: "ticket",
      },
    ],
  },
  // 5) 系统与运营
  {
    title: "nav.systemOperations",
    items: [
      {
        id: "provider-instances",
        label: "nav.providerInstances",
        href: "/admin/provider-instances",
        icon: "cloud",
      },
      {
        id: "provider-presets",
        label: "nav.providerPresets",
        href: "/admin/provider-presets",
        icon: "package",
      },
      {
        id: "provider-credentials",
        label: "nav.providerCredentials",
        href: "/admin/provider-credentials",
        icon: "key",
      },
      {
        id: "embedding-settings",
        label: "nav.embeddingSettings",
        href: "/admin/settings/embedding",
        icon: "cpu",
      },
      {
        id: "admin-notifications",
        label: "nav.adminNotifications",
        href: "/admin/notifications",
        icon: "bell",
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
