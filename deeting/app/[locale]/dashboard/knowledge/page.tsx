import { redirect } from "next/navigation"

export default async function LegacyKnowledgePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect(`/${locale}/knowledge`)
}
