import type { ReactNode } from "react"
import { NextIntlClientProvider } from "next-intl"
import { setRequestLocale } from "next-intl/server"

import { loadStaticLocaleMessages, type StaticMessageNamespace } from "@/i18n/static-messages"

const isDesktopExport = process.env.DEETING_DESKTOP_EXPORT === "true"
const ADMIN_MESSAGE_NAMESPACES = ["admin"] as const satisfies readonly StaticMessageNamespace[]

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  if (!isDesktopExport) {
    return <>{children}</>
  }

  const messages = await loadStaticLocaleMessages(locale, {
    desktopExport: true,
    namespaces: ADMIN_MESSAGE_NAMESPACES,
  })

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  )
}
