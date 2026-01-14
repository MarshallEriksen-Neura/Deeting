"use client"

import { Bell, Search, Settings } from "lucide-react"

import { GlassButton } from "@/components/ui/glass-button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ThemeToggle } from "@/components/theme-provider"

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
          <GlassButton
            variant="ghost"
            size="icon-sm"
            className="relative text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--primary)]/10"
          >
            <Bell className="size-4" />
            <span className="absolute right-1.5 top-1.5 flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--teal-accent)] opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-[var(--teal-accent)]" />
            </span>
            <span className="sr-only">Notifications</span>
          </GlassButton>
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
