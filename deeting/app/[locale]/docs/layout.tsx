import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RootProvider } from "fumadocs-ui/provider/next";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { docsI18n, docsI18nUI } from "@/lib/docs/i18n";
import { routing } from "@/i18n/routing";
import { source } from "@/lib/source";

function getDocsHref(locale: string) {
  return locale === routing.defaultLocale ? "/docs" : `/${locale}/docs`;
}

export default async function PublicDocsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  setRequestLocale(locale);
  const t = await getTranslations("common");

  return (
    <RootProvider
      i18n={docsI18nUI.provider(locale)}
      search={{ enabled: false }}
      theme={{ enabled: false }}
    >
      <div className="min-h-screen pt-24 md:pt-28">
        <DocsLayout
          tree={source.getPageTree(locale)}
          i18n={docsI18n}
          nav={{
            title: t("docs"),
            url: getDocsHref(locale),
          }}
          themeSwitch={{ enabled: false }}
          searchToggle={{ enabled: false }}
          links={[
            {
              text: t("headerNav.chat"),
              url: "/chat",
              active: "nested-url",
            },
            {
              text: t("headerNav.pluginMarket"),
              url: "/plugins/market",
              active: "nested-url",
            },
            {
              text: t("headerNav.download"),
              url: "/download",
              active: "nested-url",
            },
          ]}
          sidebar={{ defaultOpenLevel: 1 }}
        >
          {children}
        </DocsLayout>
      </div>
    </RootProvider>
  );
}
