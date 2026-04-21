"use client";

import { LanguageSwitcher } from "@/components/layout/header/language-switcher";
import { ThemeToggleButton } from "@/components/layout/header/theme-toggle-button";
import { UserMenu } from "@/components/layout/header/user-menu";
import {
  NotificationBell,
  NotificationCenter,
} from "@/components/notifications/notification-center";
import { Separator } from "@/components/ui/shadcn/separator";

export function HeaderActions() {
  return (
    <>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggleButton />
          <NotificationBell />
        </div>
        <Separator orientation="vertical" className="h-6 bg-border/70" />
        <UserMenu />
      </div>
      <NotificationCenter />
    </>
  );
}
