import { setRequestLocale } from "next-intl/server";

import { redirect } from "@/i18n/routing";
import { SettingsClient } from "./components/settings-client";
import { normalizeSettingsSection } from "./section";

export const dynamic = "force-static";

type SettingsPageProps = {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<{ section?: string | string[] }>;
};

export default async function SettingsPage({ params, searchParams }: SettingsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const sectionParam = resolvedSearchParams.section;
  const section = Array.isArray(sectionParam) ? sectionParam[0] : sectionParam;
  if (section === "ecosystem") {
    redirect({ href: "/dashboard/ecosystem", locale });
  }
  const initialSection = normalizeSettingsSection(section);

  return (
    <main className="h-full min-h-0 overflow-y-auto px-5 py-5 md:px-7 md:py-6">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col">
        <SettingsClient initialSection={initialSection} />
      </div>
    </main>
  );
}
