"use client";

import type { PropsWithChildren } from "react";
import { SidebarProvider, useSidebar } from "@/components/ui/shadcn/sidebar";
import { WorkstationSidebar } from "@/components/layout/workstation-sidebar";
import { SidebarToggle } from "@/components/layout/sidebar-toggle";
import { HeaderActions } from "@/components/layout/header/header-actions";
import { cn } from "@/lib/utils";

function AppShellBody({ children }: PropsWithChildren) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <div
      className={cn(
        "grid min-h-0 flex-1 transition-[grid-template-columns] duration-[var(--dur-slow)] ease-[var(--ease-emphasized)]",
        isCollapsed
          ? "grid-cols-[68px_minmax(0,1fr)]"
          : "grid-cols-[264px_minmax(0,1fr)]"
      )}
    >
      <WorkstationSidebar />

      <div className="h-full min-h-0">
        <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--window-bg)]">
          <header className="h-[var(--shell-toolbar-h)] shrink-0 bg-[var(--shell-chrome-bg)]">
            <div className="flex h-full items-center justify-between gap-3 px-3">
              <div className="flex items-center gap-2">
                <SidebarToggle />
              </div>
              <HeaderActions />
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            <div className="min-h-full px-[var(--shell-canvas-px)] pb-[var(--shell-canvas-pb)] pt-[var(--shell-canvas-pt)]">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export function AppShell({ children }: PropsWithChildren) {
  return (
    <SidebarProvider
      defaultOpen
      className="h-[calc(100dvh-var(--desktop-title-bar-height,0px))] min-h-0 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.72),transparent_26%),var(--window-bg)] text-[var(--ink)]"
    >
      <div className="flex h-full min-h-0 flex-col">
        <AppShellBody>{children}</AppShellBody>
      </div>
    </SidebarProvider>
  );
}
