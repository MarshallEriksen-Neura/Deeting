import type { CSSProperties } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthSync } from "@/components/auth/auth-sync";
import { DesktopOAuthListener } from "@/components/auth/desktop-oauth-listener";
import { DeferredRootEnhancements } from "@/components/common/deferred-root-enhancements";
import { PlatformProvider } from "@/lib/platform/provider";
import { TitleBar } from "@/components/common/title-bar";
import { DesktopStartupReady } from "@/components/common/desktop-startup-ready";
import "./globals.css";

const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true";
const isDesktopUserCloudSyncEnabled =
  process.env.NEXT_PUBLIC_DESKTOP_ALLOW_USER_CLOUD_SYNC === "true";
const desktopTitleBarHeight = isTauri ? "2.25rem" : "0px";
const appHeaderOffset = "5rem";
const appViewportHeight = isTauri
  ? "calc(100dvh - var(--desktop-title-bar-height))"
  : "100dvh";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={isTauri ? "antialiased pt-[var(--desktop-title-bar-height)]" : "antialiased"}
        style={
          {
            "--desktop-title-bar-height": desktopTitleBarHeight,
            "--app-header-offset": appHeaderOffset,
            "--app-viewport-height": appViewportHeight,
          } as CSSProperties
        }
      >
        <PlatformProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {isTauri && <TitleBar />}
            {isTauri && <DesktopStartupReady />}
            <AuthSync />
            {isTauri && <DesktopOAuthListener />}
            {children}
            <DeferredRootEnhancements
              isTauri={isTauri}
              enableBridgeMonitor={isDesktopUserCloudSyncEnabled}
            />
          </ThemeProvider>
        </PlatformProvider>
      </body>
    </html>
  );
}
