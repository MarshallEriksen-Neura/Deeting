import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deeting Setup",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="bg-transparent">{children}</body>
    </html>
  );
}
