import type { ReactNode } from "react"
import { NextIntlClientProvider } from "next-intl"

import {
  loadStaticLocaleMessages,
  type StaticMessageNamespace,
} from "@/i18n/static-messages"

const isDesktopExport = process.env.DEETING_DESKTOP_EXPORT === "true"

export async function DesktopRouteMessagesProvider({
  locale,
  namespaces,
  children,
}: {
  locale: string
  namespaces: readonly StaticMessageNamespace[]
  children: ReactNode
}) {
  if (!isDesktopExport) {
    return <>{children}</>
  }

  const messages = await loadStaticLocaleMessages(locale, {
    desktopExport: true,
    namespaces,
  })

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  )
}
