import { redirect } from "@/i18n/routing"

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect({ href: "/admin/provider-presets", locale })
}
