"use client"

import * as React from "react"
import { Search } from "lucide-react"
import { useTranslations } from "next-intl"
import { Input } from "@/ui/shadcn/input"
import { Tabs, TabsList, TabsTrigger } from "@/ui/shadcn/tabs"
import { useProviderHub } from "@/hooks/use-providers"
import ProviderGrid from "@/components/providers/provider-grid"
import { PlatformModelGrid } from "@/components/market/platform-model-grid"
import { useDebounce } from "@/hooks/use-debounce"

type TabValue = "all" | "cloud" | "local" | "platform"

const CATEGORY_MAPPING: Record<string, string | undefined> = {
  all: undefined,
  cloud: "cloud api",
  local: "local hosted",
}

interface ProviderMarketClientProps {
  initialData?: any
  onProviderSelect?: (provider: any) => void
  showSearch?: boolean
  className?: string
}

export function ProviderMarketClient({ 
  initialData, 
  onProviderSelect,
  showSearch = true,
  className
}: ProviderMarketClientProps) {
  const t = useTranslations("providers.market")
  const [selectedTab, setSelectedTab] = React.useState<TabValue>("all")
  const [searchQuery, setSearchQuery] = React.useState("")
  
  const debouncedQuery = useDebounce(searchQuery, 300)
  const isPlatformTab = selectedTab === "platform"

  const queryParams = React.useMemo(() => ({
    category: CATEGORY_MAPPING[selectedTab],
    q: debouncedQuery || undefined,
    include_public: true,
  }), [selectedTab, debouncedQuery])

  const { 
    providers, 
    stats, 
    isLoading 
  } = useProviderHub(isPlatformTab ? {} : queryParams)

  const displayProviders = (isLoading && !searchQuery && selectedTab === 'all' && initialData?.providers) 
    ? initialData.providers 
    : providers

  return (
    <div className={className || "space-y-8"}>
      <div className="flex flex-col items-center gap-6 max-w-2xl mx-auto">
        {showSearch && !isPlatformTab && (
          <div className="relative w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--muted)]" />
            <Input 
              placeholder={t("searchPlaceholder")} 
              className="pl-12 h-12 text-lg bg-[var(--surface)]/50 border-white/10 rounded-2xl shadow-sm focus-visible:ring-offset-2"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}

        <Tabs 
          defaultValue="all" 
          onValueChange={(value) => setSelectedTab(value as TabValue)} 
          className="w-full flex justify-center"
        >
          <TabsList className="bg-[var(--surface)]/50 backdrop-blur-md border border-white/5 p-1 h-auto rounded-full">
            <TabsTrigger value="all" className="rounded-full px-6 py-2 data-[state=active]:bg-[var(--primary)] data-[state=active]:text-white">
              {t("tabs.all")}
            </TabsTrigger>
            <TabsTrigger value="cloud" className="rounded-full px-6 py-2 data-[state=active]:bg-[var(--primary)] data-[state=active]:text-white">
              {t("tabs.cloud")}
            </TabsTrigger>
            <TabsTrigger value="local" className="rounded-full px-6 py-2 data-[state=active]:bg-[var(--primary)] data-[state=active]:text-white">
              {t("tabs.local")}
            </TabsTrigger>
            <TabsTrigger value="platform" className="rounded-full px-6 py-2 data-[state=active]:bg-[var(--primary)] data-[state=active]:text-white">
              {t("tabs.platform")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isPlatformTab ? (
        <PlatformModelGrid />
      ) : (
        <ProviderGrid 
          providers={displayProviders}
          isLoading={isLoading && !displayProviders.length}
          searchQuery={searchQuery}
          onSelect={onProviderSelect}
        />
      )}
    </div>
  )
}