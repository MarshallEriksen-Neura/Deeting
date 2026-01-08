"use client"

import { Suspense } from "react"
import { Languages } from "lucide-react"
import { useTranslations, useLocale } from "next-intl"
import { useSearchParams, usePathname as useNextPathname, useRouter as useNextRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  GlassDropdownMenu,
  GlassDropdownMenuContent,
  GlassDropdownMenuItem,
  GlassDropdownMenuLabel,
  GlassDropdownMenuSeparator,
  GlassDropdownMenuTrigger,
} from "@/components/ui/glass-dropdown"

interface LanguageSwitcherProps {
  className?: string
}

function LanguageSwitcherContent({ className }: LanguageSwitcherProps) {
  const tCommon = useTranslations("common")
  const locale = useLocale()
  const router = useNextRouter()
  const pathname = useNextPathname()
  const searchParams = useSearchParams()

  const languageOptions = [
    { value: "zh-CN", label: tCommon("language.zhCN") },
    { value: "en", label: tCommon("language.en") },
  ] as const

  const currentLanguageLabel =
    languageOptions.find((item) => item.value === locale)?.label ?? locale

  const handleLanguageChange = (value: string) => {
    if (value === locale) return

    // Get the current pathname and remove the locale prefix if present
    let newPathname = pathname
    const locales = ["zh-CN", "en"]
    for (const loc of locales) {
      if (pathname.startsWith(`/${loc}`)) {
        newPathname = pathname.slice(`/${loc}`.length) || "/"
        break
      }
    }

    // Build the new path with the selected locale
    const search = searchParams.toString()
    const newPath = value === "zh-CN"
      ? `${newPathname}${search ? `?${search}` : ""}`
      : `/${value}${newPathname}${search ? `?${search}` : ""}`

    router.replace(newPath)
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
            selected={locale === item.value}
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

