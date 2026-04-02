import type { ReactNode } from "react";
import { setRequestLocale } from "next-intl/server";

export default async function IslandLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      {/* Override root layout body styles so the Tauri transparent window
          actually shows through — body background and padding must be removed. */}
      <style>{`
        html, body {
          background: transparent !important;
          padding: 0 !important;
          margin: 0 !important;
          overflow: hidden !important;
        }
      `}</style>
      <div className="fixed inset-0 z-[9999] overflow-hidden">
        {children}
      </div>
    </>
  );
}
