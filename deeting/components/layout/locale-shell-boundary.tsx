"use client";

import type { PropsWithChildren } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { isLoginHostRoute } from "@/lib/auth/world-model";
import { usePathname } from "@/i18n/routing";

function shouldBypassShell(pathname: string) {
  return (
    pathname === "/chat" ||
    pathname.startsWith("/chat/") ||
    pathname === "/island" ||
    pathname.startsWith("/island/") ||
    isLoginHostRoute(pathname)
  );
}

export function LocaleShellBoundary({ children }: PropsWithChildren) {
  const pathname = usePathname();

  if (pathname && shouldBypassShell(pathname)) {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}
