import { setRequestLocale } from "next-intl/server";
import { SkillsClient } from "./components/skills-client";

export default async function SkillsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <SkillsClient />;
}
