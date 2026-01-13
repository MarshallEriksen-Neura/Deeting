"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { ProviderMarketClient } from "@/components/market/provider-market-client"
import type { ProviderPresetConfig } from "@/components/providers/connect-provider-drawer"

const ConnectProviderDrawer = dynamic(
  () => import("@/components/providers/connect-provider-drawer"),
  { ssr: false }
)

export function DashboardMarketClient() {
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [selectedPreset, setSelectedPreset] = React.useState<ProviderPresetConfig | null>(null)

  const handleSelect = (provider: any) => {
    const preset: ProviderPresetConfig = {
      slug: provider.slug,
      name: provider.name,
      type: provider.slug === "custom" ? "custom" : "system",
      default_endpoint: provider.base_url || undefined,
      protocol: "openai",
      brand_color: provider.theme_color || "#3b82f6",
      icon_key: provider.icon || "lucide:server",
    }
    setSelectedPreset(preset)
    setDrawerOpen(true)
  }

  return (
    <>
      <ProviderMarketClient 
        onProviderSelect={handleSelect}
        className="space-y-6"
      />
      
      <ConnectProviderDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        preset={selectedPreset}
        onSave={() => setDrawerOpen(false)}
      />
    </>
  )
}
