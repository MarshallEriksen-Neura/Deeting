import type { ReactNode } from "react"
import { setRequestLocale } from "next-intl/server"

import { DashboardLayoutClient } from "@/components/layout/dashboard-layout-client"

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

  return <DashboardLayoutClient role={userRole}>{children}</DashboardLayoutClient>
}
