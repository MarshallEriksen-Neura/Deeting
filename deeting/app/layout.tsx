import { ThemeProvider } from "@/components/theme-provider";
import { AuthSync } from "@/components/auth/auth-sync";
import { DownloadAppModal } from "@/components/ui/modal/download-app-modal";
import { DesktopCloseGuard } from "@/components/common/desktop-close-guard";
import { DesktopUpdateGuard } from "@/components/common/desktop-update-guard";
import { PlatformProvider } from "@/lib/platform/provider";
import "./globals.css";

const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <PlatformProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <AuthSync />
            {children}
            <DownloadAppModal />
            {isTauri && <DesktopCloseGuard />}
            {isTauri && <DesktopUpdateGuard />}
          </ThemeProvider>
        </PlatformProvider>
      </body>
    </html>
  );
}
