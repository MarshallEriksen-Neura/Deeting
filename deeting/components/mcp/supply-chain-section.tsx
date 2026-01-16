"use client"

import { Button } from "@/components/ui/button"
import { SyncSourceCard } from "./sync-source-card"
import { MCPSource } from "@/types/mcp"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"

const AddSourceDialog = dynamic(() => import("./add-source-dialog").then(mod => mod.AddSourceDialog), { ssr: false })

interface SupplyChainSectionProps {
  sources: MCPSource[]
  onSync: (source: MCPSource) => void
  onCreateSource: (payload: {
    name: string
    sourceType: MCPSource["type"]
    pathOrUrl: string
    trustLevel: MCPSource["trustLevel"]
    authToken?: string
  }) => void
}

export function SupplyChainSection({ sources, onSync, onCreateSource }: SupplyChainSectionProps) {
  const t = useTranslations("mcp")

  return (
    <section className="space-y-4">
       <div className="flex items-center gap-2 mb-2">
           <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">{t("supplyChain.title")}</h2>
           <div className="h-px bg-gray-100 flex-1" />
           <AddSourceDialog onCreate={onCreateSource}>
              <Button variant="ghost" size="sm" className="text-xs text-gray-500 hover:text-gray-900">
                 + {t("supplyChain.addSource")}
              </Button>
           </AddSourceDialog>
       </div>

       <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {sources.map(source => (
              <SyncSourceCard 
                  key={source.id} 
                  source={source} 
                  onSync={() => onSync(source)}
              />
          ))}
       </div>
    </section>
  )
}
