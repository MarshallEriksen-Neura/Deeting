"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import { Skeleton } from "@/components/ui/skeleton"
import { useDownloadModalStore } from "@/store/modal-store"

const ProviderMarketClient = dynamic(
  () => import("@/components/market/provider-market-client").then((mod) => mod.ProviderMarketClient),
  {
    loading: () => <ProviderMarketClientSkeleton />,
  }
)

interface PublicMarketClientProps {
  initialData?: any
}

export function PublicMarketClient({ initialData }: PublicMarketClientProps) {
  const { openDownloadModal } = useDownloadModalStore()
  const t = useTranslations("providers.market")
  
  const handleSelect = (provider: any) => {
      openDownloadModal({
          title: t("connectModal.title", { name: provider.name }),
          description: t("connectModal.description", { name: provider.name })
      })
  }

  return (
    <ProviderMarketClient 
      initialData={initialData} 
      onProviderSelect={handleSelect}
    />
  )
}

function ProviderMarketClientSkeleton() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center gap-6 max-w-2xl mx-auto">
        <Skeleton className="h-12 w-full max-w-2xl rounded-2xl" />
        <Skeleton className="h-12 w-[420px] max-w-full rounded-full" />
      </div>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="rounded-3xl border border-border/60 bg-card/80 p-6">
            <div className="space-y-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-28 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
