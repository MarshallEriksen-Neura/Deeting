"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/shadcn/sidebar";

export function SidebarToggle() {
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--panel-bg)] px-3 text-sm text-[var(--ink-2)] transition-[border-color,transform,color] duration-[var(--dur-fast)] ease-[var(--ease-standard)] hover:border-[var(--hairline-strong)] hover:text-[var(--ink)] hover:-translate-y-px"
      )}
      aria-label="Toggle sidebar"
      title="Toggle sidebar"
    >
      {isCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
      <span className="hidden md:inline">{isCollapsed ? "Expand" : "Collapse"}</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--ink-3)]">
        ⌘\
      </span>
    </button>
  );
}
