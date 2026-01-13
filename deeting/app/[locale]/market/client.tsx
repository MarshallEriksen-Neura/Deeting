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
  
  const handleSelect = (provider: any) => {
      openDownloadModal({
          title: `Connect ${provider.name}`,
          description: `To connect ${provider.name} and manage AI models securely, please download our desktop application.`
      })
  }

  return (
    <ProviderMarketClient 
      initialData={initialData} 
      onProviderSelect={handleSelect}
    />
  )
}
