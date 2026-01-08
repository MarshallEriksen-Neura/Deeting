import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { routing } from "@/i18n/routing";

export const metadata: Metadata = {
  title: "AI Higress Gateway",
  description: "Intelligent API Gateway with AI-powered routing",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang={routing.defaultLocale} className="h-full" suppressHydrationWarning>
      <body className="antialiased h-full overflow-hidden">
        <ThemeProvider defaultTheme="system" enableSystem>
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
