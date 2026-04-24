import { setRequestLocale } from "next-intl/server";

import { ModelPoolsPage } from "@/components/models/model-pools-page";

type ModelsPoolsPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function ModelsPoolsPage({ params }: ModelsPoolsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <ModelPoolsPage />;
}
