import { redirect } from "next/navigation"

export default async function LegacyMemoryPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect(`/${locale}/memory`)
}
