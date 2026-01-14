"use client"

import { useEffect, useMemo, useState } from "react"
import { GlassButton } from "@/components/ui/glass-button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useTranslations } from "next-intl"
import {
  GlassDropdownMenu,
  GlassDropdownMenuContent,
  GlassDropdownMenuItem,
  GlassDropdownMenuSeparator,
  GlassDropdownMenuTrigger,
  GlassDropdownUserHeader,
} from "@/components/ui/glass-dropdown"

interface UserMenuProps {
  userName: string
  userEmail: string
  userAvatarSrc?: string
  onLogout?: () => void
}

export function UserMenu({ userName, userEmail, userAvatarSrc, onLogout }: UserMenuProps) {
  const t = useTranslations("common.header")
  const [mounted, setMounted] = useState(false)
  const menuId = useMemo(() => `user-menu-${userEmail || userName || "guest"}`, [userEmail, userName])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const safeName = mounted ? (userName?.trim() || t("guest")) : t("guest")
  const initials = safeName.slice(0, 2).toUpperCase()

  return (
    <GlassDropdownMenu>
      <GlassDropdownMenuTrigger
        asChild
        id={`${menuId}-trigger`}
        aria-controls={`${menuId}-content`}
      >
        <GlassButton
          variant="ghost"
          className="relative h-8 w-8 rounded-full p-0 hover:ring-2 hover:ring-[var(--primary)]/20 transition-all"
        >
          <Avatar className="size-8 border border-[var(--border)]">
            <AvatarImage src={userAvatarSrc} alt={safeName} />
            <AvatarFallback
              className="text-xs font-medium"
              style={{
                background: "var(--gradient)",
                color: "white",
              }}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
        </GlassButton>
      </GlassDropdownMenuTrigger>
      <GlassDropdownMenuContent
        className="w-56"
        align="end"
        id={`${menuId}-content`}
        aria-labelledby={`${menuId}-trigger`}
      >
        <GlassDropdownUserHeader name={safeName} email={userEmail} />
        <GlassDropdownMenuSeparator />
        <GlassDropdownMenuItem>
          {t("profile")}
        </GlassDropdownMenuItem>
        <GlassDropdownMenuItem>
          {t("apiKeys")}
        </GlassDropdownMenuItem>
        <GlassDropdownMenuItem>
          {t("docs")}
        </GlassDropdownMenuItem>
        <GlassDropdownMenuSeparator />
        <GlassDropdownMenuItem
          variant="destructive"
          onSelect={() => onLogout?.()}
        >
          {t("logout")}
        </GlassDropdownMenuItem>
      </GlassDropdownMenuContent>
    </GlassDropdownMenu>
  )
}
