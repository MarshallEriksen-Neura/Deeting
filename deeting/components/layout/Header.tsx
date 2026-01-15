"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"
import { GlassButton } from "@/components/ui/glass-button"
import { Container } from "@/components/ui/container"
import { useUserProfile } from "@/hooks/use-user"
import { useAuthService } from "@/hooks/use-auth"
import { useAuthStore } from "@/store/auth-store"

import { ActionButtons } from "./header/ActionButtons"
import { LanguageSwitcher } from "./header/LanguageSwitcher"
import { NavLinks } from "./header/NavLinks"
import { UserMenu } from "./header/UserMenu"
import { DEFAULT_LOGO, defaultNavItems } from "./header/constants"
import { HeaderProps } from "./header/types"

export function Header({
  logoSrc = DEFAULT_LOGO,
  logoText = "AI Higress",
  navItems = defaultNavItems,
  userName,
  userEmail,
  userAvatarSrc,
  onMenuClick,
  className,
}: HeaderProps) {
  const pathname = usePathname()
  
  // Hide header on chat routes for immersive experience
  if (pathname?.includes("/chat")) {
    return null
  }

  const tHeader = useTranslations("common.header")
  const tNav = useTranslations("common.headerNav")
  const { isAuthenticated } = useAuthStore()
  const { profile } = useUserProfile()
  const { logout } = useAuthService()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const navWithActive = navItems.map((item) => {
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
        // Glassmorphism effect - iOS frosted glass
        "bg-white/70 dark:bg-slate-900/70 backdrop-blur-2xl",
        // iOS-style border and shadow
        "border border-black/5 dark:border-white/10",
        "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.4)]",
        // Rounded corners (iOS style)
        "rounded-2xl",
        // Smooth transitions
        "transition-all duration-300 ease-out",
        className
      )}
    >
      <Container className="flex h-16 items-center justify-between px-6" gutter="none">
        {/* Left section: Logo + Navigation */}
        <div className="flex items-center gap-6">
          {/* Mobile menu button */}
          <GlassButton
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={onMenuClick}
          >
            <Menu className="size-5" />
            <span className="sr-only">Toggle menu</span>
          </GlassButton>

          {/* Logo */}
          <Link
            href="/"
            className="flex items-center transition-all duration-200 ease-out hover:opacity-75 active:scale-95"
          >
            <Image
              src={logoSrc}
              alt={logoText}
              width={200}
              height={40}
              className="h-7 w-auto object-contain sm:h-8 lg:h-9 xl:h-10"
              priority
            />
          </Link>

          <NavLinks items={navWithActive} />
        </div>

        <div className="flex items-center gap-2">
          <ActionButtons />
          <LanguageSwitcher />
          <div className="mx-1 h-5 w-px bg-black/10 dark:bg-white/10" />
          {mounted && isAuthenticated ? (
            <UserMenu
              userName={profile?.username ?? profile?.email ?? userName ?? tHeader("guest")}
              userEmail={profile?.email ?? userEmail ?? ""}
              userAvatarSrc={userAvatarSrc}
              onLogout={logout}
            />
          ) : (
            <GlassButton
              asChild
              variant="ghost"
              size="sm"
              className="h-9 px-4 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-all duration-200 ease-out active:scale-95"
            >
              <Link href="/login">{tHeader("login")}</Link>
            </GlassButton>
          )}
        </div>
      </Container>
    </header>
  )
}

export default Header
