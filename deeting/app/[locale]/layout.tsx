import type { ReactNode } from "react"
import { NextIntlClientProvider } from "next-intl"
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server"
import { HeaderShell } from "@/components/layout/HeaderShell"
import { defaultNavItems } from "@/components/layout/header/constants"
import { routing } from "@/i18n/routing"
import { loadStaticLocaleMessages, type StaticMessageNamespace } from "@/i18n/static-messages"
import { NotificationProvider } from "@/components/contexts/notification-context"
import { DeferredLocaleEnhancements } from "@/components/common/deferred-locale-enhancements"

const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"
const isDesktopExport = process.env.DEETING_DESKTOP_EXPORT === "true"
const DESKTOP_ROOT_MESSAGE_NAMESPACES: readonly StaticMessageNamespace[] = [
  "common",
  "notifications",
  "home",
  "auth",
]

export const dynamicParams = false

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  auth,
  params,
}: {
  children: ReactNode
  auth: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  setRequestLocale(locale)

  const messages = isDesktopExport
    ? await loadStaticLocaleMessages(locale, {
        desktopExport: true,
        namespaces: DESKTOP_ROOT_MESSAGE_NAMESPACES,
      })
    : await getMessages()
  const t = isDesktopExport
    ? ((key: string) => {
        const value = messages.common?.[key]
        return typeof value === "string" ? value : key
      })
    : await getTranslations("common")

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <NotificationProvider>
        <HeaderShell
          logoText={t("brand")}
          navItems={defaultNavItems}
          userName="Admin"
          userEmail="admin@higress.ai"
        >
          {children}
        </HeaderShell>
        {auth}
        <DeferredLocaleEnhancements isTauri={isTauri} />
      </NotificationProvider>
    </NextIntlClientProvider>
  )
}
