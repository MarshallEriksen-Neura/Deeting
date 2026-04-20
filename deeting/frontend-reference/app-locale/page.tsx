import { setRequestLocale } from "next-intl/server"
import { LandingPage } from "@/components/landing/landing-page"

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <LandingPage />
}