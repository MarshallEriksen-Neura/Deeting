"use client";

import { LanguageSwitcher } from "@/components/layout/header/language-switcher";
import { HeaderAuthControl } from "@/components/layout/header/header-auth-control";
import { ThemeToggleButton } from "@/components/layout/header/theme-toggle-button";
import { NotificationBell } from "@/components/notifications/notification-center";
import { Separator } from "@/components/ui/shadcn/separator";

export function HeaderActions() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <LanguageSwitcher />
        <ThemeToggleButton />
        <NotificationBell />
      </div>
      <Separator orientation="vertical" className="h-6 bg-border/70" />
      <HeaderAuthControl />
    </div>
  );
}
