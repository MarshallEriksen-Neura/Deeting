import type { ReactNode } from "react"
import { setRequestLocale } from "next-intl/server"

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar/sidebar-context"
import { Sidebar, SidebarContent, SidebarFooter, SidebarTrigger } from "@/components/ui/sidebar/sidebar"
import { AppSidebarNav } from "@/components/ui/sidebar/app-sidebar-nav"
import { getNavigationByRole } from "@/components/layout/sidebar/navigation-config"
import { GlassButton } from "@/components/ui/glass-button"
import { PanelLeftClose, PanelLeft } from "lucide-react"

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  // In a real app, you would get the user role from auth context
  // For now, we'll default to "user" - change to "admin" to see admin navigation
  const userRole: "admin" | "user" = "user"
  const navigation = getNavigationByRole(userRole)

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="grid min-h-screen w-full grid-cols-1 bg-[var(--background)] md:grid-cols-[auto_1fr]">
        {/* Sidebar Column */}
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

        {/* Main Column */}
        <SidebarInset className="w-full">
          {children}
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
