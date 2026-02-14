import type { ReactNode } from "react"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar/sidebar-context"
import { Sidebar, SidebarContent, SidebarFooter, SidebarTrigger } from "@/components/ui/sidebar/sidebar"
import { AppSidebarNav } from "@/components/ui/sidebar/app-sidebar-nav"
import { adminNavigation } from "@/components/layout/sidebar/navigation-config"

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations("admin.common")

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="grid min-h-screen w-full grid-cols-1 bg-[var(--background)] md:grid-cols-[auto_1fr]">
        {/* Sidebar Column */}
        <Sidebar collapsible="icon" className="md:h-[calc(100vh-56px)]">
          <SidebarContent className="p-4">
            <AppSidebarNav groups={adminNavigation} />
          </SidebarContent>

          <SidebarFooter>
            <div className="w-full flex items-center justify-start group-data-[collapsible=icon]:justify-center">
              <SidebarTrigger className="w-full justify-start gap-2 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center px-2">
                <span className="group-data-[collapsible=icon]:hidden truncate">{t("collapseSidebar")}</span>
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
