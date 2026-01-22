import { ThemeProvider } from "@/components/theme-provider";
import { ThemeTransitionOverlay } from "@/components/theme-transition-overlay";
import { AuthSync } from "@/components/auth/auth-sync";
import { DownloadAppModal } from "@/components/ui/modal/download-app-modal";
import { PlatformProvider } from "@/lib/platform/provider";
import { Toaster } from "sonner";
import "./globals.css";

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
            <ThemeTransitionOverlay />
            <AuthSync />
            {children}
            <DownloadAppModal />
            <Toaster position="bottom-right" />
          </ThemeProvider>
        </PlatformProvider>
      </body>
    </html>
  );
}
