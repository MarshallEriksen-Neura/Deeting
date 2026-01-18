"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { cva } from "class-variance-authority"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { useSidebar } from "./sidebar-context"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  type NavGroup,
  type NavItem,
} from "@/components/layout/sidebar/navigation-config"
import { navIconMap, defaultNavIcon } from "@/components/layout/sidebar/icon-map"

// ============================================================================
// Variants
// ============================================================================

const sidebarItemVariants = cva(
  [
    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5",
    "text-sm font-medium",
    // iOS-style smooth transitions
    "transition-all duration-200 ease-out",
    "outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50",
    "w-full",
  ],
  {
    variants: {
      active: {
        true: [
          // iOS-style active state - soft blue background
          "bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400",
          "shadow-[0_0_0_1px_rgba(59,130,246,0.15),inset_0_1px_0_rgba(255,255,255,0.1)]",
        ],
        false: [
          // iOS-style inactive state
          "text-slate-600 dark:text-slate-300",
          "hover:bg-slate-100/80 dark:hover:bg-slate-800/80",
          "active:scale-[0.98]", // iOS-style press feedback
        ],
      },
      collapsed: {
        true: "justify-center px-2",
        false: "",
      },
    },
    defaultVariants: {
      active: false,
      collapsed: false,
    },
  }
)

const mobileNavItemVariants = cva(
  [
    "flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2",
    "text-sm font-medium",
    // iOS-style smooth transitions
    "transition-all duration-200 ease-out",
    "active:scale-95", // iOS-style press feedback
  ],
  {
    variants: {
      active: {
        true: [
          // iOS-style active state
          "bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400",
        ],
        false: [
          // iOS-style inactive state
          "text-slate-600 dark:text-slate-300",
          "hover:bg-slate-100/80 dark:hover:bg-slate-800/80",
        ],
      },
    },
    defaultVariants: {
      active: false,
    },
  }
)

// ============================================================================
// Components
// ============================================================================

interface AppSidebarNavProps {
  groups: NavGroup[]
}

export function AppSidebarNav({ groups }: AppSidebarNavProps) {
  const { state, isMobile } = useSidebar()
  const isCollapsed = state === "collapsed"
  const t = useTranslations("common")

  const translate = React.useCallback(
    (key: string) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return t(key as any)
      } catch {
        return key.split(".").pop() || key
      }
    },
    [t]
  )

  if (isMobile) {
    const allItems = groups.flatMap((group) => group.items)
    return (
      <div className="flex items-center gap-1">
        {allItems.map((item) => (
          <SidebarItem
            key={item.id}
            item={item}
            isCollapsed={false}
            translate={translate}
            isMobile={true}
          />
        ))}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-4", isCollapsed && "gap-2")}>
      {groups.map((group) => (
        <SidebarGroup
          key={group.title}
          group={group}
          isCollapsed={isCollapsed}
        />
      ))}
    </div>
  )
}

interface SidebarGroupProps {
  group: NavGroup
  isCollapsed?: boolean
}

function SidebarGroup({ group, isCollapsed = false }: SidebarGroupProps) {
  const [isExpanded, setIsExpanded] = React.useState(true)
  const t = useTranslations("common")

  const translate = React.useCallback(
    (key: string) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return t(key as any)
      } catch {
        return key.split(".").pop() || key
      }
    },
    [t]
  )

  return (
    <div className="flex flex-col gap-1">
      {!isCollapsed && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 transition-all duration-200 ease-out hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100/50 dark:hover:bg-slate-800/50"
        >
          <ChevronDown
            className={cn(
              "size-3 transition-transform duration-200",
              !isExpanded && "-rotate-90"
            )}
          />
          {translate(group.title)}
        </button>
      )}

      {isCollapsed && (
        <div className="mx-auto my-2 h-px w-6 bg-[var(--border)]/50" />
      )}

      {isExpanded && (
        <div className="flex flex-col gap-0.5">
          {group.items.map((item) => (
            <SidebarItem key={item.id} item={item} isCollapsed={isCollapsed} translate={translate} />
          ))}
        </div>
      )}
    </div>
  )
}

interface SidebarItemProps {
  item: NavItem
  isCollapsed?: boolean
  translate: (key: string) => string
  isMobile?: boolean
}

function SidebarItem({ item, isCollapsed = false, translate, isMobile = false }: SidebarItemProps) {
  const pathname = usePathname()
  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
  const Icon = navIconMap[item.icon] ?? defaultNavIcon
  const label = translate(item.label)

  if (isMobile) {
    return (
      <Link
        href={item.href}
        className={cn(mobileNavItemVariants({ active: isActive }))}
        aria-current={isActive ? "page" : undefined}
      >
        <Icon className="size-4 shrink-0" />
        <span>{label}</span>
        {item.badge && item.badge > 0 && (
          <span className="flex size-4 items-center justify-center rounded-full bg-[var(--primary)] text-[9px] font-semibold text-white">
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        )}
      </Link>
    )
  }

  const content = (
    <Link
      href={item.href}
      className={cn(sidebarItemVariants({ active: isActive, collapsed: isCollapsed }))}
      aria-current={isActive ? "page" : undefined}
    >
      {/* Active indicator */}
      {isActive && (
        <span
          className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-blue-500 dark:bg-blue-400"
          aria-hidden
        />
      )}

      <Icon
        className={cn(
          "size-5 shrink-0 transition-transform duration-200",
          isActive ? "text-blue-600 dark:text-blue-400" : "text-slate-500 dark:text-slate-400",
          "group-hover:scale-105"
        )}
      />

      {!isCollapsed && (
        <>
          <span className="flex-1 truncate">{label}</span>

          {item.badge && item.badge > 0 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-[var(--primary)] text-[10px] font-semibold text-white">
              {item.badge > 99 ? "99+" : item.badge}
            </span>
          )}
        </>
      )}
    </Link>
  )

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={12}>
          <div className="flex items-center gap-2">
            {label}
            {item.badge && item.badge > 0 && (
              <span className="flex size-4 items-center justify-center rounded-full bg-[var(--primary)] text-[9px] font-semibold text-white">
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    )
  }

  return content
}
