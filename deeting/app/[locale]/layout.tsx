import type { ReactNode } from "react"
import { NextIntlClientProvider } from "next-intl"
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server"
import { HeaderShell } from "@/components/layout/HeaderShell"
import { defaultNavItems } from "@/components/layout/header/constants"
import { routing } from "@/i18n/routing"
import { loadStaticLocaleMessages } from "@/i18n/static-messages"
import { NotificationProvider } from "@/components/contexts/notification-context"
import { NotificationSystem } from "@/components/notifications/notification-system"
import { AppLoadingOverlay } from "@/components/common/app-loading-overlay"
import { DesktopCloseGuard } from "@/components/common/desktop-close-guard"
import { DesktopTrayLocaleSync } from "@/components/common/desktop-tray-locale-sync"

const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"
const isDesktopExport = process.env.DEETING_DESKTOP_EXPORT === "true"

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
    ? await loadStaticLocaleMessages(locale)
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
        <AppLoadingOverlay />
        <HeaderShell
          logoText={t("brand")}
          navItems={defaultNavItems}
          userName="Admin"
          userEmail="admin@higress.ai"
        >
          {children}
        </HeaderShell>
        {auth}
        {isTauri && <DesktopCloseGuard />}
        {isTauri && <DesktopTrayLocaleSync />}
        {/* 全局通知系统 */}
        <NotificationSystem />
      </NotificationProvider>
    </NextIntlClientProvider>
  )
}
