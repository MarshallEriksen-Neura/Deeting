"use client"

import type { ReactNode } from "react"

import { useUserProfile } from "@/hooks/use-user"
import { getNavigationByRole } from "@/components/layout/sidebar/navigation-config"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar/sidebar-context"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
} from "@/components/ui/sidebar/sidebar"
import { AppSidebarNav } from "@/components/ui/sidebar/app-sidebar-nav"

export function DashboardShell({ children }: { children: ReactNode }) {
  const { profile } = useUserProfile()
  const userRole: "admin" | "user" = profile?.is_superuser ? "admin" : "user"
  const navigation = getNavigationByRole(userRole)

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="grid min-h-screen w-full grid-cols-1 bg-[var(--background)] md:grid-cols-[auto_1fr]">
        <Sidebar collapsible="icon" className="md:h-[calc(100vh-56px)]">
          <SidebarContent className="p-4">
            <AppSidebarNav groups={navigation} />
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
