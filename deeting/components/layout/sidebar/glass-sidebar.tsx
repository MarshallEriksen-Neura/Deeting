"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { cva } from "class-variance-authority"
import { ChevronDown, PanelLeftClose, PanelLeft, Bot } from "lucide-react"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { useMarketStore } from "@/store/market-store"
import { GlassButton } from "@/components/ui/glass-button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  type NavGroup,
  type NavItem,
  userNavigation,
  adminNavigation,
} from "./navigation-config"
import { navIconMap, defaultNavIcon } from "./icon-map"

/**
 * iOS-style Glass Sidebar (Secondary Navigation)
 *
 * Features:
 * - Glassmorphism effects with backdrop blur
 * - Smooth animations and transitions
 * - Desktop: Left sidebar below main Header
 * - Mobile: Horizontal scrollable nav below main Header
 * - Support for both admin and user navigation configurations
 * - Collapsible sidebar with icon-only mode
 * - i18n support for navigation labels
 */

// Header height constant (h-14 = 56px)
const HEADER_HEIGHT = 56

// ============================================================================
// Sidebar Context
// ============================================================================

interface SidebarContextValue {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  isCollapsed: boolean
  setIsCollapsed: (collapsed: boolean) => void
  isMobile: boolean
  t: (key: string) => string
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within GlassSidebarProvider")
  }
  return context
}

// ============================================================================
// Variants
// ============================================================================

const sidebarItemVariants = cva(
  [
    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5",
    "text-sm font-medium",
    "transition-all duration-200 ease-out",
    "outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/50",
  ],
  {
    variants: {
      active: {
        true: [
          "bg-[var(--primary)]/10 text-[var(--primary)]",
          "shadow-[0_0_0_1px_rgba(124,109,255,0.2),inset_0_1px_0_rgba(255,255,255,0.05)]",
        ],
        false: [
          "text-[var(--muted)] hover:text-[var(--foreground)]",
          "hover:bg-[var(--foreground)]/5",
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
    "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2",
    "text-sm font-medium",
    "transition-all duration-200 ease-out",
  ],
  {
    variants: {
      active: {
        true: [
          "bg-[var(--primary)]/10 text-[var(--primary)]",
        ],
        false: [
          "text-[var(--muted)] hover:text-[var(--foreground)]",
          "hover:bg-[var(--foreground)]/5",
        ],
      },
    },
    defaultVariants: {
      active: false,
    },
  }
)

// ============================================================================
// Sidebar Item Component (Desktop)
// ============================================================================

interface SidebarItemProps {
  item: NavItem
  isCollapsed?: boolean
}

function SidebarItem({ item, isCollapsed = false }: SidebarItemProps) {
  const pathname = usePathname()
  const { t } = useSidebar()
  const hrefPath = item.href.split("?")[0]
  const isActive = pathname === hrefPath || pathname.startsWith(`${hrefPath}/`)

  const Icon = navIconMap[item.icon] ?? defaultNavIcon
  const label = t(item.label)

  const content = (
    <Link
      href={item.href}
      className={cn(sidebarItemVariants({ active: isActive, collapsed: isCollapsed }))}
      aria-current={isActive ? "page" : undefined}
    >
      {/* Active indicator */}
      {isActive && (
        <span
          className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[var(--primary)]"
          aria-hidden
        />
      )}

      <Icon
        className={cn(
          "size-5 shrink-0 transition-transform duration-200",
          isActive && "text-[var(--primary)]",
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

// ============================================================================
// Sidebar Group Component (Desktop)
// ============================================================================

interface SidebarGroupProps {
  group: NavGroup
  isCollapsed?: boolean
}

function SidebarGroup({ group, isCollapsed = false }: SidebarGroupProps) {
  const [isExpanded, setIsExpanded] = React.useState(true)
  const { t } = useSidebar()

  return (
    <div className="flex flex-col gap-1">
      {!isCollapsed && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]/70 transition-colors hover:text-[var(--muted)]"
        >
          <ChevronDown
            className={cn(
              "size-3 transition-transform duration-200",
              !isExpanded && "-rotate-90"
            )}
          />
          {t(group.title)}
        </button>
      )}

      {isCollapsed && (
        <div className="mx-auto my-2 h-px w-6 bg-[var(--border)]/50" />
      )}

      {isExpanded && (
        <div className="flex flex-col gap-0.5">
          {group.items.map((item) => (
            <SidebarItem key={item.id} item={item} isCollapsed={isCollapsed} />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Desktop Sidebar Component
// ============================================================================

interface DesktopSidebarProps {
  navigation: NavGroup[]
}

function DesktopSidebar({ navigation }: DesktopSidebarProps) {
  const { isCollapsed, setIsCollapsed } = useSidebar()
  const installedAgents = useMarketStore((state) => state.installedAgents)
  const loadLocalAssistants = useMarketStore((state) => state.loadLocalAssistants)
  const loaded = useMarketStore((state) => state.loaded)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  React.useEffect(() => {
    if (!mounted || loaded) return
    void loadLocalAssistants()
  }, [mounted, loaded, loadLocalAssistants])

  // Construct My Agents group
  const myAgentsGroup: NavGroup | null = React.useMemo(() => {
    if (!mounted || installedAgents.length === 0) return null
    return {
      title: "My Agents",
      items: installedAgents.map(agent => ({
        id: `agent-${agent.id}`,
        label: agent.name,
        href: `/chat/${encodeURIComponent(agent.id)}`, // 假设安装后的助手跳转到 chat 页面
        icon: "Bot" as const, // 使用 Bot 图标，需要在 icon-map 中确保有映射或直接在这里处理图标
      }))
    }
  }, [mounted, installedAgents])

  return (
    <aside
      data-collapsed={isCollapsed}
      className={cn(
        "fixed left-0 z-30 flex flex-col",
        "bg-[var(--card)]/60 backdrop-blur-xl",
        "border-r border-white/10",
        "shadow-[4px_0_16px_-4px_rgba(0,0,0,0.05)]",
        "transition-[width] duration-300 ease-out",
        isCollapsed ? "w-[72px]" : "w-[260px]"
      )}
      style={{
        top: HEADER_HEIGHT,
        height: `calc(100vh - ${HEADER_HEIGHT}px)`,
      }}
    >
      {/* Inner border glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          boxShadow: "inset -1px 0 0 rgba(255,255,255,0.05)",
        }}
      />

      {/* Navigation */}
      <ScrollArea className="flex-1">
        <div className={cn("flex flex-col gap-4 p-4", isCollapsed && "p-2")}>
          {navigation.map((group) => (
            <SidebarGroup
              key={group.title}
              group={group}
              isCollapsed={isCollapsed}
            />
          ))}
          
          {/* My Agents Group */}
          {myAgentsGroup && (
             <div className="flex flex-col gap-1 pt-4 border-t border-white/5">
                {!isCollapsed && (
                  <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]/70">
                    My Agents
                  </div>
                )}
                {isCollapsed && <div className="mx-auto my-2 h-px w-6 bg-[var(--border)]/50" />}
                
                <div className="flex flex-col gap-0.5">
                  {myAgentsGroup.items.map((item) => (
                    // 这里直接复用 SidebarItem，但要注意 icon 映射
                    // 由于 SidebarItem 内部用了 navIconMap，我们需要确保 Bot 图标能正常显示
                    // 或者我们这里为了简单，手动渲染一下，或者临时修改 navIconMap
                    // 鉴于 SidebarItem 的 icon 属性是 string，我们需要在 icon-map.ts 里加一个 Bot
                    // 或者我们在 SidebarItem 里增加对未知 icon 的 fallback
                    <SidebarItem key={item.id} item={item} isCollapsed={isCollapsed} />
                  ))}
                </div>
             </div>
          )}
        </div>
      </ScrollArea>

      {/* Collapse Toggle */}
      <div className={cn("shrink-0 p-4", isCollapsed && "p-2")}>
        <GlassButton
          variant="ghost"
          size={isCollapsed ? "icon" : "default"}
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn("w-full", !isCollapsed && "justify-start")}
        >
          {isCollapsed ? (
            <PanelLeft className="size-5" />
          ) : (
            <>
              <PanelLeftClose className="size-5" />
              <span>Collapse</span>
            </>
          )}
        </GlassButton>
      </div>
    </aside>
  )
}

// ============================================================================
// Mobile Secondary Nav Component (Horizontal scroll below Header)
// ============================================================================

interface MobileSecondaryNavProps {
  navigation: NavGroup[]
}

function MobileSecondaryNav({ navigation }: MobileSecondaryNavProps) {
  const pathname = usePathname()
  const { t } = useSidebar()
  const installedAgents = useMarketStore((state) => state.installedAgents)
  const loadLocalAssistants = useMarketStore((state) => state.loadLocalAssistants)
  const loaded = useMarketStore((state) => state.loaded)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  React.useEffect(() => {
    if (!mounted || loaded) return
    void loadLocalAssistants()
  }, [mounted, loaded, loadLocalAssistants])

  // Flatten all nav items for horizontal display
  const allItems = navigation.flatMap((group) => group.items)

  // Append installed agents if mounted
  const finalItems = mounted && installedAgents.length > 0 
    ? [...allItems, ...installedAgents.map(agent => ({
        id: `agent-${agent.id}`,
        label: agent.name,
        href: `/chat/${encodeURIComponent(agent.id)}`,
        icon: "Bot" as const,
        badge: 0
      }))]
    : allItems

  return (
    <div
      className={cn(
        "sticky z-30 w-full",
        "bg-[var(--surface)]/80 backdrop-blur-xl",
        "border-b border-[var(--border)]/50",
      )}
      style={{ top: HEADER_HEIGHT }}
    >
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex items-center gap-1 px-4 py-2">
          {finalItems.map((item) => {
            const hrefPath = item.href.split("?")[0]
            const isActive = pathname === hrefPath || pathname.startsWith(`${hrefPath}/`)
            const Icon = navIconMap[item.icon as keyof typeof navIconMap] ?? defaultNavIcon
            const label = item.id.startsWith('agent-') ? item.label : t(item.label)

            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(mobileNavItemVariants({ active: isActive }))}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="size-4 shrink-0" />
                <span>{label}</span>
                {item.badge && item.badge > 0 && (
                  <span className="flex size-4 items-center justify-center rounded-full bg-[var(--primary)] text-[9px] font-semibold text-white">
                    {item.badge > 9 ? "9+" : item.badge}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main GlassSidebar Component
// ============================================================================

export interface GlassSidebarProps {
  /** User role for navigation configuration */
  role?: "admin" | "user"
  /** Custom navigation groups (overrides role-based config) */
  navigation?: NavGroup[]
  /** Default collapsed state */
  defaultCollapsed?: boolean
  /** Children content (main content area) */
  children?: React.ReactNode
}

export function GlassSidebarProvider({
  role = "user",
  navigation: customNavigation,
  defaultCollapsed = false,
  children,
}: GlassSidebarProps) {
  const isMobile = useIsMobile()
  const [isOpen, setIsOpen] = React.useState(false)
  const [isCollapsed, setIsCollapsed] = React.useState(defaultCollapsed)

  // Get translations for navigation
  const tNav = useTranslations("common")

  // Translation helper that safely handles keys
  const t = React.useCallback(
    (key: string) => {
      try {
        return tNav(key as any)
      } catch {
        // Fallback to key if translation not found
        return key.split(".").pop() || key
      }
    },
    [tNav]
  )

  // Get navigation based on role or use custom navigation
  const navigation = customNavigation ?? (role === "admin" ? adminNavigation : userNavigation)

  const contextValue = React.useMemo(
    () => ({
      isOpen,
      setIsOpen,
      isCollapsed,
      setIsCollapsed,
      isMobile,
      t,
    }),
    [isOpen, isCollapsed, isMobile, t]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        {isMobile ? (
          <>
            {/* Mobile: Horizontal secondary nav below header */}
            <MobileSecondaryNav navigation={navigation} />
            {/* Main content */}
            <main>{children}</main>
          </>
        ) : (
          <>
            {/* Desktop: Left sidebar */}
            <DesktopSidebar navigation={navigation} />
            {/* Main content with left margin for fixed sidebar */}
            <main
              className={cn(
                "transition-[margin-left] duration-300 ease-out",
                isCollapsed ? "ml-[72px]" : "ml-[260px]"
              )}
            >
              {children}
            </main>
          </>
        )}
      </TooltipProvider>
    </SidebarContext.Provider>
  )
}

// ============================================================================
// Sidebar Trigger for External Use
// ============================================================================

export function GlassSidebarTrigger({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { isMobile, isCollapsed, setIsCollapsed } = useSidebar()

  // On mobile, the secondary nav is always visible, no trigger needed
  if (isMobile) {
    return null
  }

  return (
    <GlassButton
      variant="ghost"
      size="icon"
      onClick={() => setIsCollapsed(!isCollapsed)}
      className={className}
      {...props}
    >
      {isCollapsed ? (
        <PanelLeft className="size-5" />
      ) : (
        <PanelLeftClose className="size-5" />
      )}
    </GlassButton>
  )
}

// ============================================================================
// Exports
// ============================================================================

export { useSidebar, type NavGroup, type NavItem }
