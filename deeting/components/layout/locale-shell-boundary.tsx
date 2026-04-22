"use client";

import type { PropsWithChildren } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { usePathname } from "@/i18n/routing";

function isChatRoute(pathname: string) {
  return pathname === "/chat" || pathname.startsWith("/chat/");
}

export function LocaleShellBoundary({ children }: PropsWithChildren) {
  const pathname = usePathname();

  if (pathname && isChatRoute(pathname)) {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}
