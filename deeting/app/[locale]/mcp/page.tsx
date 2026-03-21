import dynamic from "next/dynamic"
import { setRequestLocale } from "next-intl/server"
import { Skeleton } from "@/components/ui/skeleton"
import { DesktopRouteMessagesProvider } from "@/components/common/desktop-route-messages-provider"

const MCPRegistryClient = dynamic(
  () => import("@/components/mcp/mcp-registry-client").then((mod) => mod.MCPRegistryClient),
  {
    loading: () => <McpRegistrySkeleton />,
  }
)
export default async function MCPRegistryPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <DesktopRouteMessagesProvider
      locale={locale}
      namespaces={["common", "mcp"]}
    >
      <MCPRegistryClient
        initialTools={[]}
        initialSources={[]}
      />
    </DesktopRouteMessagesProvider>
  )
}

function McpRegistrySkeleton() {
  return (
    <div className="relative min-h-screen bg-[var(--background)] px-6 py-12 lg:px-8">
      <div className="relative mx-auto max-w-7xl space-y-10">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-3xl border border-border/60 bg-card/80 p-6">
            <div className="space-y-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
