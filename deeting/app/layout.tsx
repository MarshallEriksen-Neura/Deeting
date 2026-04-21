import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { DesktopTitlebarShell } from "@/components/common/desktop-titlebar-shell";
import { AppProviders } from "@/components/providers/app-providers";
import { PlatformProvider } from "@/lib/platform/provider";
import "./globals.css";

const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true";
const desktopTitleBarHeight = isTauri ? "2.25rem" : "0px";
const appHeaderTopInset = isTauri ? "0.5rem" : "1rem";
const appHeaderOffset = `calc(4rem + ${appHeaderTopInset})`;
const appViewportHeight = isTauri
  ? "calc(100dvh - var(--desktop-title-bar-height))"
  : "100dvh";

export const metadata: Metadata = {
  title: "Deeting",
  description: "Deeting workstation shell scaffold",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="bg-[var(--window-bg)] pt-[var(--desktop-title-bar-height,0px)] font-[family:var(--font-text)] text-[var(--ink)] antialiased"
        style={
          {
            "--desktop-title-bar-height": desktopTitleBarHeight,
            "--app-header-top-inset": appHeaderTopInset,
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
            <DesktopTitlebarShell />
            <AppProviders>{children}</AppProviders>
          </ThemeProvider>
        </PlatformProvider>
      </body>
    </html>
  );
}
