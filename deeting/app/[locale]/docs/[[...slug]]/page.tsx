import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "@/components/docs/docs-page";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import { source } from "@/lib/source";

export default async function PublicDocsPage({
  params,
}: {
  params: Promise<{ locale: string; slug?: string[] }>;
}) {
  const { locale, slug } = await params;

  setRequestLocale(locale);

  const page = source.getPage(slug, locale);
  if (!page) {
    notFound();
  }

  const MDXContent = page.data.body;

  return (
    <DocsPage
      toc={page.data.toc}
      breadcrumb={{ enabled: true }}
      footer={{ enabled: true }}
      tableOfContent={{ enabled: true }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDXContent />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams("slug", "locale").filter((params) =>
    routing.locales.includes(params.locale as (typeof routing.locales)[number])
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug?: string[] }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const page = source.getPage(slug, locale);

  if (!page) {
    return {};
  }

  return {
    title: `${page.data.title} | Deeting Docs`,
    description: page.data.description,
  };
}
