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
    <div className="h-screen w-screen overflow-hidden bg-transparent">
      {children}
    </div>
  );
}
