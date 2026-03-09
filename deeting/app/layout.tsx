import { ThemeProvider } from "@/components/theme-provider";
import { AuthSync } from "@/components/auth/auth-sync";
import { DesktopOAuthListener } from "@/components/auth/desktop-oauth-listener";
import { DownloadAppModal } from "@/components/ui/modal/download-app-modal";
import { DesktopUpdateGuard } from "@/components/common/desktop-update-guard";
import { BridgeMonitor } from "@/components/bridge/bridge-monitor";
import { ToolApprovalDialog } from "@/components/bridge/tool-approval-dialog";
import { PlatformProvider } from "@/lib/platform/provider";
import "./globals.css";

const isTauri = process.env.NEXT_PUBLIC_IS_TAURI === "true";
const isDesktopUserCloudSyncEnabled =
  process.env.NEXT_PUBLIC_DESKTOP_ALLOW_USER_CLOUD_SYNC === "true";

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
            {isTauri && <DesktopOAuthListener />}
            {children}
            <DownloadAppModal />
            {isTauri && <DesktopUpdateGuard />}
            {isTauri && isDesktopUserCloudSyncEnabled && <BridgeMonitor />}
            {isTauri && <ToolApprovalDialog />}
          </ThemeProvider>
        </PlatformProvider>
      </body>
    </html>
  );
}
