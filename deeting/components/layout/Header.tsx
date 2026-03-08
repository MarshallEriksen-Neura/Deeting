"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu, X, Download } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"
import { GlassButton } from "@/components/ui/glass-button"
import { Container } from "@/components/ui/container"
import { useUserProfile } from "@/hooks/use-user"
import { useAuthService } from "@/hooks/use-auth"
import { useAuthStore } from "@/store/auth-store"

const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true"

import { ActionButtons } from "./header/ActionButtons"
import { LanguageSwitcher } from "./header/LanguageSwitcher"
import { NavLinks } from "./header/NavLinks"
import { UserMenu } from "./header/UserMenu"
import { DEFAULT_LOGO, defaultNavItems } from "./header/constants"
import { HeaderProps } from "./header/types"
import { shouldHideGlobalHeader } from "./header/visibility"

export function Header({
  logoSrc = DEFAULT_LOGO,
  logoText = "AI Higress",
  navItems = defaultNavItems,
  userName,
  userEmail,
  userAvatarSrc,
  className,
}: HeaderProps) {
  const pathname = usePathname()

  // All hooks must be called before any conditional return
  const tHeader = useTranslations("common.header")
  const tNav = useTranslations("common.headerNav")
  const { isAuthenticated } = useAuthStore()
  const { profile } = useUserProfile()
  const { logout } = useAuthService()
  const [mounted, setMounted] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  if (shouldHideGlobalHeader(pathname)) {
    return null
  }

  const visibleNavItems = navItems.filter((item) => {
    if (!item.href.startsWith("/admin")) {
      return true
    }

    return Boolean(profile?.is_superuser)
  })

  const navWithActive = visibleNavItems.map((item) => {
    const match =
      pathname === item.href ||
      pathname.startsWith(`${item.href}/`)
    const isActive = item.isActive ?? match
    const label = (() => {
      try {
        return tNav(item.label as any)
      } catch {
        return item.label
      }
    })()

    return { ...item, label, isActive }
  })

  return (
    <header
      className={cn(
        // iOS-style floating header
        "fixed top-4 left-4 right-4 z-50",
        // Glassmorphism effect
        "bg-white/70 dark:bg-slate-900/70 backdrop-blur-2xl",
        // iOS-style border and shadow
        "border border-black/5 dark:border-white/10",
        "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.4)]",
        // Rounded corners
        "rounded-2xl",
        // Smooth transitions
        "transition-all duration-300 ease-out",
        className
      )}
    >
      {/* Main header bar */}
      <Container className="flex h-16 items-center justify-between px-4 sm:px-6">
        {/* Left section: Hamburger (mobile) + Logo + Nav (desktop) */}
        <div className="flex items-center gap-3 sm:gap-6 min-w-0">
          {/* Mobile menu toggle */}
          <GlassButton
            variant="ghost"
            size="icon-sm"
            className="md:hidden shrink-0"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen
              ? <X className="size-5" />
              : <Menu className="size-5" />
            }
          </GlassButton>

          {/* Logo */}
          <Link
            href="/"
            className="flex items-center shrink-0 transition-all duration-200 ease-out hover:opacity-75 active:scale-95"
          >
            <Image
              src={logoSrc}
              alt={logoText}
              width={200}
              height={40}
              className="h-7 w-auto object-contain sm:h-8 lg:h-9"
              priority
            />
          </Link>

          {/* Desktop nav links */}
          <NavLinks items={navWithActive} />
        </div>

        {/* Right section */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {/* Action buttons + language — desktop only */}
          <div className="hidden md:flex items-center gap-1">
            {/* Download button — hidden on Tauri desktop */}
            {!isTauri && (
              <GlassButton
                asChild
                size="sm"
                className="h-8 px-3 text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white border-0 shadow-md shadow-blue-500/20 hover:shadow-lg hover:shadow-blue-500/30 transition-all duration-200"
              >
                <a
                  href="https://github.com/MarshallEriksen-Neura/Deeting/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="size-3.5" />
                  Download
                </a>
              </GlassButton>
            )}
            <ActionButtons />
            <LanguageSwitcher />
            <div className="mx-1 h-5 w-px bg-black/10 dark:bg-white/10" />
          </div>

          {/* User menu / login — always visible */}
          {mounted && isAuthenticated ? (
            <UserMenu
              userName={profile?.username ?? profile?.email ?? userName ?? tHeader("guest")}
              userEmail={profile?.email ?? userEmail ?? ""}
              isAdmin={Boolean(profile?.is_superuser)}
              userAvatarSrc={userAvatarSrc}
              onLogout={logout}
            />
          ) : (
            <GlassButton
              asChild
              variant="ghost"
              size="sm"
              className="h-9 px-3 sm:px-4 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-all duration-200 ease-out active:scale-95"
            >
              <Link href={`/login?callbackUrl=${encodeURIComponent(pathname || "/")}`}>
                {tHeader("login")}
              </Link>
            </GlassButton>
          )}
        </div>
      </Container>

      {/* Mobile menu panel */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-black/5 dark:border-white/10 px-4 pb-4 pt-2">
          {/* Nav items */}
          <nav className="flex flex-col gap-0.5 mb-3">
            {navWithActive.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                  "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white",
                  "hover:bg-slate-100/80 dark:hover:bg-slate-800/60",
                  item.isActive && [
                    "text-slate-900 dark:text-white",
                    "bg-slate-100/80 dark:bg-slate-800/60",
                  ]
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Divider */}
          <div className="h-px bg-black/5 dark:bg-white/10 mb-3" />

          {/* Action buttons + language switcher */}
          <div className="flex items-center gap-1 flex-wrap">
            {!isTauri && (
              <GlassButton
                asChild
                size="sm"
                className="h-8 px-3 text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 text-white border-0 shadow-md"
              >
                <a
                  href="https://github.com/MarshallEriksen-Neura/Deeting/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="size-3.5" />
                  Download
                </a>
              </GlassButton>
            )}
            <ActionButtons />
            <LanguageSwitcher />
          </div>
        </div>
      )}
    </header>
  )
}

export default Header
