"use client"

import type { ElementType } from "react"
import { Boxes, Bot, Database, Globe, Server } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"
import { isBrowserAgentPanelEnabled } from "./browser-agent-panel-flags"

export type SettingsSection =
  | "models"
  | "storage"
  | "agent"
  | "browser"
  | "relay"

export interface NavItem {
  id: SettingsSection
  icon: ElementType
  desktopOnly: boolean
}

const NAV_ITEMS: NavItem[] = [
  { id: "models", icon: Boxes, desktopOnly: false },
  { id: "storage", icon: Database, desktopOnly: true },
  { id: "agent", icon: Bot, desktopOnly: true },
  { id: "browser", icon: Globe, desktopOnly: true },
  { id: "relay", icon: Server, desktopOnly: true },
]

interface SettingsNavProps {
  activeSection: SettingsSection
  onSectionChange: (section: SettingsSection) => void
  isTauriRuntime: boolean
}

export function SettingsNav({
  activeSection,
  onSectionChange,
  isTauriRuntime,
}: SettingsNavProps) {
  const t = useI18n("settings")
  const isBrowserSectionVisible = isBrowserAgentPanelEnabled()

  const visibleItems = NAV_ITEMS.filter(
    (item) =>
      (!item.desktopOnly || isTauriRuntime) &&
      (item.id !== "browser" || isBrowserSectionVisible)
  )

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex md:w-56 md:shrink-0 md:flex-col md:gap-1">
        {visibleItems.map((item) => {
          const Icon = item.icon
          const isActive = activeSection === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-all duration-200 cursor-pointer",
                isActive
                  ? "bg-primary/[0.06] text-foreground dark:bg-primary/[0.08]"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              )}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary transition-all" />
              )}
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200",
                  isActive
                    ? "bg-primary/12 text-primary shadow-sm dark:bg-primary/15"
                    : "bg-muted/50 text-muted-foreground group-hover:bg-muted/70 group-hover:text-foreground dark:bg-muted/30"
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="font-medium">{t(`nav.${item.id}`)}</span>
                <span className="mt-0.5 text-[11px] text-muted-foreground/80">
                  {t(`nav.${item.id}Desc`)}
                </span>
              </span>
            </button>
          )
        })}
      </nav>

      {/* Mobile horizontal tabs */}
      <nav className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-muted/25 p-1 md:hidden dark:bg-muted/15">
        {visibleItems.map((item) => {
          const Icon = item.icon
          const isActive = activeSection === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 cursor-pointer",
                isActive
                  ? "bg-background text-foreground shadow-sm dark:bg-background/80"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className={cn("h-3.5 w-3.5", isActive && "text-primary")} />
              <span>{t(`nav.${item.id}`)}</span>
            </button>
          )
        })}
      </nav>
    </>
  )
}
