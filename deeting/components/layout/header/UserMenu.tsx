"use client"

import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
}

export function UserMenu({ userName, userEmail, userAvatarSrc }: UserMenuProps) {
  return (
    <GlassDropdownMenu>
      <GlassDropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="relative h-8 w-8 rounded-full p-0 hover:ring-2 hover:ring-[var(--primary)]/20 transition-all"
        >
          <Avatar className="size-8 border border-[var(--border)]">
            <AvatarImage src={userAvatarSrc} alt={userName} />
            <AvatarFallback
              className="text-xs font-medium"
              style={{
                background: "var(--gradient)",
                color: "white",
              }}
            >
              {userName.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </Button>
      </GlassDropdownMenuTrigger>
      <GlassDropdownMenuContent className="w-56" align="end">
        <GlassDropdownUserHeader name={userName} email={userEmail} />
        <GlassDropdownMenuSeparator />
        <GlassDropdownMenuItem>
          Profile
        </GlassDropdownMenuItem>
        <GlassDropdownMenuItem>
          API Keys
        </GlassDropdownMenuItem>
        <GlassDropdownMenuItem>
          Documentation
        </GlassDropdownMenuItem>
        <GlassDropdownMenuSeparator />
        <GlassDropdownMenuItem variant="destructive">
          Log out
        </GlassDropdownMenuItem>
      </GlassDropdownMenuContent>
    </GlassDropdownMenu>
  )
}

