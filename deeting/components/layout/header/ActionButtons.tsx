"use client"

import { Search, Settings } from "lucide-react"

import { GlassButton } from "@/components/ui/glass-button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ThemeToggle } from "@/components/theme-provider"
import { NotificationBell } from "@/components/notifications/notification-center"

export function ActionButtons() {
  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <GlassButton
            variant="ghost"
            size="icon-sm"
            className="text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--primary)]/10"
          >
            <Search className="size-4" />
            <span className="sr-only">Search</span>
          </GlassButton>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Search</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative">
            <NotificationBell />
            <span className="sr-only">Notifications</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Notifications</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <GlassButton
            variant="ghost"
            size="icon-sm"
            className="text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--primary)]/10"
          >
            <Settings className="size-4" />
            <span className="sr-only">Settings</span>
          </GlassButton>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Settings</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <ThemeToggle size="sm" />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>切换主题</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
