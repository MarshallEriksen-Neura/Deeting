import { setRequestLocale } from "next-intl/server"

import { AssetsClient } from "./components/assets-client"

export default async function AssetsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return <AssetsClient />
}
