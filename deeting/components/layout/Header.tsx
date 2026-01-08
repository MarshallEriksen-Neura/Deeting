"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Menu } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Container } from "@/components/ui/container"

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
  userName = "User",
  userEmail = "user@example.com",
  userAvatarSrc,
  onMenuClick,
  className,
}: HeaderProps) {
  const pathname = usePathname()

  const navWithActive = navItems.map((item) => {
    const match =
      pathname === item.href ||
      pathname.startsWith(`${item.href}/`)
    const isActive = item.isActive ?? match

    return { ...item, isActive }
  })

  return (
    <header
      className={cn(
        // Base layout
        "sticky top-0 z-50 w-full",
        // Glassmorphism effect - Digital Ink style
        "bg-[var(--surface)]/80 backdrop-blur-xl",
        // Subtle bottom border
        "border-b border-[var(--border)]/50",
        // Diffuse shadow
        "shadow-[0_4px_20px_-2px_rgba(124,109,255,0.05)]",
        className
      )}
    >
      <Container className="flex h-14 items-center justify-between" gutter="md">
        {/* Left section: Logo + Navigation */}
        <div className="flex items-center gap-6">
          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={onMenuClick}
          >
            <Menu className="size-5" />
            <span className="sr-only">Toggle menu</span>
          </Button>

          {/* Logo */}
          <Link
            href="/"
            className="flex items-center transition-opacity hover:opacity-80"
          >
            <Image
              src={logoSrc}
              alt={logoText}
              width={160}
              height={32}
              className="h-32 w-auto object-contain"
              priority
            />
          </Link>

          <NavLinks items={navWithActive} />
        </div>

        <div className="flex items-center gap-1">
          <ActionButtons />
          <LanguageSwitcher />
          <div className="mx-2 h-6 w-px bg-[var(--border)]" />
          <UserMenu
            userName={userName}
            userEmail={userEmail}
            userAvatarSrc={userAvatarSrc}
          />
        </div>
      </Container>
    </header>
  )
}

export default Header
