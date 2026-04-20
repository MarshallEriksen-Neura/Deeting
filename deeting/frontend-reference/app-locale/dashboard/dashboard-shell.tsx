"use client"

import type { ReactNode } from "react"

import { getUserDashboardNavigation } from "@/components/layout/sidebar/navigation-config"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar/sidebar-context"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
} from "@/components/ui/sidebar/sidebar"
import { AppSidebarNav } from "@/components/ui/sidebar/app-sidebar-nav"

const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"
const dashboardNavigation = getUserDashboardNavigation({ isDesktopRuntime: isTauri })

export function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen={true}>
      <div
        className="grid w-full grid-cols-1 bg-[var(--background)] md:grid-cols-[auto_1fr]"
        style={{
          minHeight:
            "calc(var(--app-viewport-height, 100dvh) - var(--app-header-offset, 5rem))",
        }}
      >
        <Sidebar collapsible="icon">
          <SidebarContent className="p-4">
            <AppSidebarNav groups={dashboardNavigation} />
          </SidebarContent>

          <SidebarFooter>
            <div className="w-full flex items-center justify-start group-data-[collapsible=icon]:justify-center">
              <SidebarTrigger className="w-full justify-start gap-2 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center px-2">
                <span className="group-data-[collapsible=icon]:hidden truncate">Collapse Sidebar</span>
              </SidebarTrigger>
            </div>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="w-full">{children}</SidebarInset>
      </div>
    </SidebarProvider>
  )
}
