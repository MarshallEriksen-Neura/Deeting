"use client"

import * as React from "react"
import { Search } from "lucide-react"
import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Loader2 } from "lucide-react"
import { useProviderHub } from "@/hooks/use-providers"
import ProviderGrid from "@/components/providers/provider-grid"
import { useDebounce } from "@/hooks/use-debounce"
import dynamic from "next/dynamic"
import type { ProviderPresetConfig } from "@/components/providers/connect-provider-drawer"

const ConnectProviderDrawer = dynamic(
  () => import("@/components/providers/connect-provider-drawer"),
  { ssr: false }
)

// Category mapping for filtering
const CATEGORY_MAPPING = {
  all: undefined,
  cloud: "cloud api",
  local: "local hosted",
  custom: "custom",
} as const

export function ProviderMarketManager() {
  const t = useTranslations("providers.market")
  const [selectedCategory, setSelectedCategory] = React.useState<keyof typeof CATEGORY_MAPPING>("all")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [selectedPreset, setSelectedPreset] = React.useState<ProviderPresetConfig | null>(null)
  
  // Debounce search query for performance
  const debouncedQuery = useDebounce(searchQuery, 300)

  // Fetch providers with optimized parameters
  const queryParams = React.useMemo(() => ({
    category: CATEGORY_MAPPING[selectedCategory],
    q: debouncedQuery || undefined,
    // 仅统计用户自己的实例，避免公共模板把“已连接/数量”标识撑满
    include_public: false,
  }), [selectedCategory, debouncedQuery])

  const { 
    providers, 
    stats, 
    isLoading, 
    isError, 
    error 
  } = useProviderHub(queryParams)

  // Error state
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {t("error.loadFailed")} {error?.message || t("error.unknown")}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      {/* Controls Section */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        {/* Category Tabs */}
        <Tabs 
          defaultValue="all" 
          onValueChange={(value) => setSelectedCategory(value as keyof typeof CATEGORY_MAPPING)} 
          className="w-full md:w-auto"
        >
          <TabsList className="bg-[var(--surface)]/50 backdrop-blur-md border border-white/5 p-1 h-auto rounded-xl w-full md:w-auto grid grid-cols-4 md:flex">
            <TabsTrigger value="all" className="rounded-lg px-4 py-2 data-[state=active]:bg-[var(--card)] data-[state=active]:text-[var(--primary)] data-[state=active]:shadow-sm">
              {t("tabs.all")}
              {!isLoading && stats && <span className="ml-1 text-xs opacity-70 hidden sm:inline">({stats.total})</span>}
            </TabsTrigger>
            <TabsTrigger value="cloud" className="rounded-lg px-4 py-2 data-[state=active]:bg-[var(--card)] data-[state=active]:text-[var(--primary)] data-[state=active]:shadow-sm">
              {t("tabs.cloud")}
              {!isLoading && stats?.by_category?.["cloud api"] && <span className="ml-1 text-xs opacity-70 hidden sm:inline">({stats.by_category["cloud api"]})</span>}
            </TabsTrigger>
            <TabsTrigger value="local" className="rounded-lg px-4 py-2 data-[state=active]:bg-[var(--card)] data-[state=active]:text-[var(--primary)] data-[state=active]:shadow-sm">
              {t("tabs.local")}
              {!isLoading && stats?.by_category?.["local hosted"] && <span className="ml-1 text-xs opacity-70 hidden sm:inline">({stats.by_category["local hosted"]})</span>}
            </TabsTrigger>
            <TabsTrigger value="custom" className="rounded-lg px-4 py-2 data-[state=active]:bg-[var(--card)] data-[state=active]:text-[var(--primary)] data-[state=active]:shadow-sm">
              {t("tabs.custom")}
              {!isLoading && stats?.by_category?.custom && <span className="ml-1 text-xs opacity-70 hidden sm:inline">({stats.by_category.custom})</span>}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Search */}
        <div className="relative w-full md:w-[320px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted)]" />
          <Input 
            placeholder={t("searchPlaceholder")} 
            className="pl-9 bg-[var(--surface)]/50 border-white/10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Provider Grid */}
      <ProviderGrid 
        providers={providers}
        isLoading={isLoading}
        searchQuery={searchQuery}
        onSelect={(provider) => {
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
        }}
      />

      <ConnectProviderDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        preset={selectedPreset}
        onSave={() => setDrawerOpen(false)}
      />
    </div>
  )
}
