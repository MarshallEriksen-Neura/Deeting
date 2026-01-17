"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import { ProviderMarketClient } from "@/components/market/provider-market-client"
import { useDownloadModalStore } from "@/store/modal-store"

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
