"use client";

import { LanguageSwitcher } from "@/components/layout/header/language-switcher";
import { ThemeToggleButton } from "@/components/layout/header/theme-toggle-button";
import { UserMenu } from "@/components/layout/header/user-menu";
import {
  NotificationBell,
  NotificationCenter,
} from "@/components/notifications/notification-center";

export function HeaderActions() {
  return (
    <>
      <div className="flex items-center gap-2">
        <LanguageSwitcher />
        <ThemeToggleButton />
        <NotificationBell />
        <UserMenu />
      </div>
      <NotificationCenter />
    </>
  );
}
