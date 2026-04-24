import type { ReactNode } from "react"
import { NextIntlClientProvider } from "next-intl"
import { setRequestLocale } from "next-intl/server"

import {
  loadStaticLocaleMessages,
  type StaticMessageNamespace,
} from "@/i18n/static-messages"

const ISLAND_MESSAGE_NAMESPACES: readonly StaticMessageNamespace[] = [
  "common",
  "chat",
]

export default async function IslandLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  const messages = await loadStaticLocaleMessages(locale, {
    desktopExport: true,
    namespaces: ISLAND_MESSAGE_NAMESPACES,
  })

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <>
        <style>{`
          html, body {
            background: transparent !important;
            background-color: transparent !important;
            background-image: none !important;
            padding: 0 !important;
            margin: 0 !important;
            overflow: hidden !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
          }
          body::before, body::after {
            display: none !important;
          }
          [data-tauri-drag-region] {
            background: transparent !important;
            background-color: transparent !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            box-shadow: none !important;
          }
        `}</style>
        <div className="fixed inset-0 z-[9999] overflow-hidden">{children}</div>
      </>
    </NextIntlClientProvider>
  )
}
