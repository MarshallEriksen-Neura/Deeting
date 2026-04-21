"use client";

import { useMemo } from "react";
import { LogIn, LogOut, Settings, User as UserIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/shadcn/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/shadcn/avatar";
import { IconButton } from "@/components/ui/common/icon-button";
import { Link } from "@/i18n/routing";
import { useUserProfile } from "@/hooks/use-user";
import { useAuthService } from "@/hooks/use-auth";

function getFallbackInitials(name: string) {
  const value = name.trim();
  if (!value) {
    return "GU";
  }
  return value.slice(0, 2).toUpperCase();
}

export function UserMenu() {
  const t = useTranslations("common.header");
  const { profile, isAuthenticated } = useUserProfile();
  const { logout } = useAuthService();

  const name = useMemo(() => profile?.username || profile?.email || t("guest"), [profile, t]);
  const email = profile?.email ?? "";
  const avatarUrl = profile?.avatar_url ?? undefined;
  const initials = getFallbackInitials(name);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton
          variant="surface"
          size="md"
          label={isAuthenticated ? name : t("login")}
          className="rounded-full p-0"
        >
          <Avatar className="size-8 border border-border/70">
            <AvatarImage src={avatarUrl} alt={name} />
            <AvatarFallback className="bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent-ink)]">
              {initials}
            </AvatarFallback>
          </Avatar>
        </IconButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-56"
        collisionPadding={8}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{name}</p>
          {email ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
        </div>
        <DropdownMenuSeparator />

        {isAuthenticated ? (
          <>
            <DropdownMenuItem asChild>
              <Link href="/settings" className="flex items-center gap-2">
                <Settings className="size-4 text-muted-foreground" />
                {t("profile")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center gap-2 text-red-600 focus:text-red-600"
              onClick={() => void logout()}
            >
              <LogOut className="size-4" />
              {t("logout")}
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem asChild>
            <Link href="/login" className="flex items-center gap-2">
              <LogIn className="size-4 text-muted-foreground" />
              {t("login")}
            </Link>
          </DropdownMenuItem>
        )}

        {!isAuthenticated ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="flex items-center gap-2" disabled>
              <UserIcon className="size-4 text-muted-foreground" />
              {t("guest")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
