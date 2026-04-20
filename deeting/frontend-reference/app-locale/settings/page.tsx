import dynamic from "next/dynamic"
import { setRequestLocale } from "next-intl/server"
import { Container } from "@/ui/common/container"
import { Skeleton } from "@/ui/shadcn/skeleton"
import { DesktopRouteMessagesProvider } from "@/components/common/desktop-route-messages-provider"

const SettingsClient = dynamic(
  () => import("./components/settings-client").then((mod) => mod.SettingsClient),
  {
    loading: () => <SettingsClientSkeleton />,
  }
)

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <DesktopRouteMessagesProvider
      locale={locale}
      namespaces={["common", "settings"]}
    >
      <SettingsClient />
    </DesktopRouteMessagesProvider>
  )
}

function SettingsClientSkeleton() {
  return (
    <Container
      as="main"
      gutter="md"
      size="full"
      className="py-6 md:py-8 !mx-0 !max-w-none"
    >
      <div className="space-y-6">
        <div className="rounded-3xl border border-border/60 bg-card/80 p-6">
          <div className="space-y-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
        </div>
        <div className="rounded-3xl border border-border/60 bg-card/80 p-6">
          <div className="space-y-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        </div>
      </div>
    </Container>
  )
}
