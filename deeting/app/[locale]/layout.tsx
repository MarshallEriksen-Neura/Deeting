import type { ReactNode } from "react"
import { NextIntlClientProvider } from "next-intl"
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server"
import { Header } from "@/components/layout/Header"
import { defaultNavItems } from "@/components/layout/header/constants"
import { routing, type AppLocale } from "@/i18n/routing"

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
      <Header
        logoText={t("brand")}
        navItems={defaultNavItems}
        userName="Admin"
        userEmail="admin@higress.ai"
      />
      {children}
      {auth}
    </NextIntlClientProvider>
  )
}
