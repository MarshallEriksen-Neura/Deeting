import dynamic from "next/dynamic"
import { PackagePlus } from "lucide-react"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { AdminPageShell, AdminSkeleton } from "@/components/admin"

const PageContent = dynamic(
  () => import("./page-content").then((mod) => ({ default: mod.PageContent })),
  {
    loading: () => (
      <div className="space-y-4">
        <AdminSkeleton variant="form" />
        <AdminSkeleton variant="table" rows={4} />
      </div>
    ),
  }
)

export default async function NewProviderPresetPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const tAdmin = await getTranslations({ locale, namespace: "admin" })

  return (
    <AdminPageShell
      title={tAdmin("providerPresetsEditor.createTitle")}
      description={tAdmin("providerPresetsEditor.createDescription")}
      icon={<PackagePlus />}
    >
      <PageContent />
    </AdminPageShell>
  )
}
