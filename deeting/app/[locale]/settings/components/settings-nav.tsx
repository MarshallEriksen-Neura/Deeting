"use client"

import type { ElementType } from "react"
import {
  AppWindow,
  Boxes,
  Bot,
  Database,
  Globe,
  Keyboard,
  KeyRound,
  Network,
  Rocket,
  Server,
} from "lucide-react"
import type { SettingsSection } from "../section"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"
import { isBrowserAgentPanelEnabled } from "./browser-agent-panel-flags"

export interface NavItem {
  id: SettingsSection
  icon: ElementType
  desktopOnly: boolean
}

const NAV_ITEMS: NavItem[] = [
  { id: "models", icon: Boxes, desktopOnly: false },
  { id: "aiAccess", icon: KeyRound, desktopOnly: true },
  { id: "ecosystem", icon: Network, desktopOnly: true },
  { id: "storage", icon: Database, desktopOnly: true },
  { id: "agent", icon: Bot, desktopOnly: true },
  { id: "browser", icon: Globe, desktopOnly: true },
  { id: "relay", icon: Server, desktopOnly: true },
  { id: "shortcuts", icon: Keyboard, desktopOnly: true },
  { id: "window", icon: AppWindow, desktopOnly: true },
  { id: "version", icon: Rocket, desktopOnly: true },
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
      <aside className="hidden md:block md:w-[292px] md:shrink-0">
        <div className="sticky top-0 overflow-hidden rounded-[26px] border border-[var(--hairline-strong)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--panel-bg)_78%,white_22%)_0%,color-mix(in_srgb,var(--panel-bg-inset)_82%,white_18%)_100%)] p-3 shadow-[var(--elev-floating)]">
          <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--accent-border),transparent)]" />
      

          <nav className="flex flex-col gap-1.5">
            {visibleItems.map((item, index) => {
              const Icon = item.icon
              const isActive = activeSection === item.id
              const label = t(`nav.${item.id}`)
              const description = t(`nav.${item.id}Desc`)

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSectionChange(item.id)}
                  className={cn(
                    "group relative overflow-hidden rounded-[20px] border px-3 py-3 text-left transition-all duration-[var(--dur-medium)] ease-[var(--ease-standard)]",
                    isActive
                      ? "border-[var(--accent-border)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--accent-soft)_78%,white_22%)_0%,color-mix(in_srgb,var(--panel-bg)_80%,white_20%)_100%)] shadow-[0_16px_34px_-26px_color-mix(in_srgb,var(--accent-strong)_42%,transparent)]"
                      : "border-transparent bg-transparent hover:border-[var(--hairline)] hover:bg-[color-mix(in_srgb,var(--panel-bg)_60%,white_40%)]"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border transition-colors",
                        isActive
                          ? "border-[var(--accent-border)] bg-[color-mix(in_srgb,var(--panel-bg)_62%,white_38%)] text-[var(--accent-strong)]"
                          : "border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-3)] group-hover:text-[var(--ink)]"
                      )}
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className={cn("text-[14px] font-semibold tracking-[-0.02em]", isActive ? "text-[var(--ink)]" : "text-[var(--ink-2)]")}>
                          {label}
                        </span>
                        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--ink-4)]">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                      </div>
                      <p className="mt-1 text-[12px] leading-5 text-[var(--ink-3)]">
                        {description}
                      </p>
                    </div>
                  </div>
                </button>
              )
            })}
          </nav>
        </div>
      </aside>

      <nav className="mb-5 flex gap-2 overflow-x-auto pb-1 md:hidden">
        {visibleItems.map((item) => {
          const Icon = item.icon
          const isActive = activeSection === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-all duration-[var(--dur-fast)]",
                isActive
                  ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                  : "border-[var(--hairline)] bg-[var(--panel-bg)] text-[var(--ink-2)]"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{t(`nav.${item.id}`)}</span>
            </button>
          )
        })}
      </nav>
    </>
  )
}
