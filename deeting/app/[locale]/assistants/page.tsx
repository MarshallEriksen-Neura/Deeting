import dynamic from "next/dynamic"
import { getTranslations, setRequestLocale } from "next-intl/server"

import { Skeleton } from "@/components/ui/skeleton"

import { DesktopRouteMessagesProvider } from "@/components/common/desktop-route-messages-provider"

const AssistantsPageClient = dynamic(
  () => import("./assistants-page-client").then((mod) => mod.AssistantsPageClient),
  { loading: () => <AssistantsContentSkeleton /> }
)

export default async function AssistantsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: "assistants" })

  return (
    <DesktopRouteMessagesProvider
      locale={locale}
      namespaces={["common", "assistants"]}
    >
      <main className="min-h-screen bg-muted/20 p-8">
        <div className="space-y-8">
          <section className="relative max-w-2xl mx-auto py-10 text-center">
            <div className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-[150%] w-[120%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-primary/20 via-purple-500/20 to-pink-500/20 opacity-50 blur-3xl" />
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {t("page.hero.titlePrefix")}{" "}
              <span className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                {t("page.hero.titleHighlight")}
              </span>
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              {t("page.hero.subtitle")}
            </p>
          </section>

          <AssistantsPageClient />
        </div>
      </main>
    </DesktopRouteMessagesProvider>
  )
}

function AssistantsContentSkeleton() {
  return (
    <div className="space-y-8 pb-20">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex justify-center">
          <Skeleton className="h-11 w-36 rounded-xl" />
        </div>

        <div className="rounded-xl border border-border/50 bg-background p-2 shadow-xl">
          <div className="flex items-center gap-3 px-3">
            <Skeleton className="h-5 w-5 rounded-full" />
            <Skeleton className="h-12 flex-1 rounded-lg" />
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-20 rounded-full" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="rounded-3xl border border-border/60 bg-background/90 p-6 shadow-sm"
          >
            <div className="space-y-4">
              <Skeleton className="h-12 w-12 rounded-2xl" />
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <div className="flex gap-2 pt-2">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
