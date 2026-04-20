import { setRequestLocale } from "next-intl/server"
import { DesktopRouteMessagesProvider } from "@/components/common/desktop-route-messages-provider"
import { MCPRegistryClient } from "@/components/mcp/mcp-registry-client"
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
