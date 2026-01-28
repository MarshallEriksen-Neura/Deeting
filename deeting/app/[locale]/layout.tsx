import type { ReactNode } from "react"
import { NextIntlClientProvider } from "next-intl"
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server"
import { HeaderShell } from "@/components/layout/HeaderShell"
import { defaultNavItems } from "@/components/layout/header/constants"
import { routing, type AppLocale } from "@/i18n/routing"
import { NotificationProvider } from "@/components/contexts/notification-context"
import { NotificationSystem } from "@/components/notifications/notification-system"
import { AppLoadingOverlay } from "@/components/common/app-loading-overlay"

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

  const messages = await getMessages()
  const t = await getTranslations("common")

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
        {/* 全局通知系统 */}
        <NotificationSystem />
      </NotificationProvider>
    </NextIntlClientProvider>
  )
}
