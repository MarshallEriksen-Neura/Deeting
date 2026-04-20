import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { DesktopTitlebarShell } from "@/components/common/desktop-titlebar-shell";
import { AppProviders } from "@/components/providers/app-providers";
import "./globals.css";

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
      <body className="bg-[var(--window-bg)] pt-[var(--desktop-title-bar-height,0px)] font-[family:var(--font-text)] text-[var(--ink)] antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <DesktopTitlebarShell />
          <AppProviders>{children}</AppProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
