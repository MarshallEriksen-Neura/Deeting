"use client"

import type { ElementType } from "react"
import { Boxes, Bot, Server } from "lucide-react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"

export type SettingsSection = "models" | "agent" | "relay"

export interface NavItem {
  id: SettingsSection
  icon: ElementType
  desktopOnly: boolean
}

const NAV_ITEMS: NavItem[] = [
  { id: "models", icon: Boxes, desktopOnly: false },
  { id: "agent", icon: Bot, desktopOnly: true },
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

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.desktopOnly || isTauriRuntime
  )

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex md:w-52 md:shrink-0 md:flex-col md:gap-1">
        {visibleItems.map((item) => {
          const Icon = item.icon
          const isActive = activeSection === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all duration-200 cursor-pointer",
                isActive
                  ? "bg-white/15 text-foreground shadow-[0_2px_8px_-2px_rgba(0,0,0,0.15)] dark:bg-white/10"
                  : "text-muted-foreground hover:bg-white/8 hover:text-foreground dark:hover:bg-white/5"
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "bg-white/10 text-muted-foreground group-hover:text-foreground dark:bg-white/5"
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex flex-col leading-tight">
                <span className="font-medium">{t(`nav.${item.id}`)}</span>
                <span className="text-[11px] text-muted-foreground">
                  {t(`nav.${item.id}Desc`)}
                </span>
              </span>
            </button>
          )
        })}
      </nav>

      {/* Mobile horizontal tabs */}
      <nav className="mb-4 flex gap-1 overflow-x-auto md:hidden">
        {visibleItems.map((item) => {
          const Icon = item.icon
          const isActive = activeSection === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all duration-200 cursor-pointer",
                isActive
                  ? "bg-white/15 text-foreground shadow-[0_2px_8px_-2px_rgba(0,0,0,0.15)] dark:bg-white/10"
                  : "text-muted-foreground hover:bg-white/8 hover:text-foreground dark:hover:bg-white/5"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="font-medium">{t(`nav.${item.id}`)}</span>
            </button>
          )
        })}
      </nav>
    </>
  )
}
