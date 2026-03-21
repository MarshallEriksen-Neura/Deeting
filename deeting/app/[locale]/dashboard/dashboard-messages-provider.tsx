import type { ReactNode } from "react"
import { NextIntlClientProvider } from "next-intl"

import { loadStaticLocaleMessages, type StaticMessageNamespace } from "@/i18n/static-messages"

const isDesktopExport = process.env.DEETING_DESKTOP_EXPORT === "true"
const DASHBOARD_MESSAGE_NAMESPACES: readonly StaticMessageNamespace[] = [
  "common",
  "dashboard",
  "credits",
  "monitoring",
  "memory",
  "plugins",
  "task-agents",
  "providers",
  "models",
  "logs",
  "knowledge",
]

export async function DashboardMessagesProvider({
  locale,
  children,
}: {
  locale: string
  children: ReactNode
}) {
  if (!isDesktopExport) {
    return <>{children}</>
  }

  const messages = await loadStaticLocaleMessages(locale, {
    desktopExport: true,
    namespaces: DASHBOARD_MESSAGE_NAMESPACES,
  })

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  )
}
