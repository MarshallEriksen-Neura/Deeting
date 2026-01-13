"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { Languages } from "lucide-react"
import { useTranslations, useLocale } from "next-intl"
import { useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  GlassDropdownMenu,
  GlassDropdownMenuContent,
  GlassDropdownMenuItem,
  GlassDropdownMenuLabel,
  GlassDropdownMenuSeparator,
  GlassDropdownMenuTrigger,
} from "@/components/ui/glass-dropdown"
import { usePathname, useRouter, type AppLocale } from "@/i18n/routing"
import { useLanguageStore } from "@/store/language-store"

interface LanguageSwitcherProps {
  className?: string
}

function LanguageSwitcherContent({ className }: LanguageSwitcherProps) {
  const tCommon = useTranslations("common")
  const locale = useLocale()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)

  const { language, hydrated, setLanguage } = useLanguageStore()

  useEffect(() => {
    setMounted(true)
  }, [])

  const activeLanguage =
    mounted && hydrated && language ? language : (locale as AppLocale)
  const query = useMemo(
    () => Object.fromEntries(searchParams.entries()),
    [searchParams]
  )

  const languageOptions = [
    { value: "zh-CN" as AppLocale, label: tCommon("language.zhCN") },
    { value: "en" as AppLocale, label: tCommon("language.en") },
  ]

  const currentLanguageLabel =
    languageOptions.find((item) => item.value === activeLanguage)?.label ??
    activeLanguage

  const syncLocale = useCallback(
    (targetLocale: AppLocale) => {
      const hasQuery = Object.keys(query).length > 0

      router.replace(
        {
          pathname,
          query: hasQuery ? query : undefined,
        },
        { locale: targetLocale }
      )
    },
    [pathname, query, router]
  )

  useEffect(() => {
    if (!hydrated) return

    if (!language) {
      setLanguage(locale as AppLocale)
      return
    }

    if (language !== locale) {
      syncLocale(language)
    }
  }, [hydrated, language, locale, setLanguage, syncLocale])

  const handleLanguageChange = (value: AppLocale) => {
    if (value === locale) return

    setLanguage(value)
    syncLocale(value)
  }

  return (
    <GlassDropdownMenu>
      <GlassDropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2 text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--primary)]/10"
        >
          <Languages className="size-4" />
          <span className="ml-2 hidden text-sm font-medium md:inline">
            {currentLanguageLabel}
          </span>
        </Button>
      </GlassDropdownMenuTrigger>
      <GlassDropdownMenuContent className="w-48" align="end">
        <GlassDropdownMenuLabel>
          {tCommon("language.label")}
        </GlassDropdownMenuLabel>
        <GlassDropdownMenuSeparator />
        {languageOptions.map((item) => (
          <GlassDropdownMenuItem
            key={item.value}
            selected={activeLanguage === item.value}
            onClick={() => handleLanguageChange(item.value)}
          >
            {item.label}
          </GlassDropdownMenuItem>
        ))}
      </GlassDropdownMenuContent>
    </GlassDropdownMenu>
  )
}

function LanguageSwitcherFallback() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-9 px-2 text-[var(--muted)]"
      disabled
    >
      <Languages className="size-4" />
    </Button>
  )
}

export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  return (
    <Suspense fallback={<LanguageSwitcherFallback />}>
      <LanguageSwitcherContent className={className} />
    </Suspense>
  )
}
