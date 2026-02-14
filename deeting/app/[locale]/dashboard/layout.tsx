import type { ReactNode } from "react"
import { setRequestLocale } from "next-intl/server"

import { DashboardShell } from "./dashboard-shell"

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <DashboardShell>{children}</DashboardShell>
}
