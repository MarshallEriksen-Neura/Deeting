"use client"

import { Button } from "@/components/ui/shadcn/button"
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
       <div className="flex items-center gap-3 mb-2">
           <h2 className="text-sm font-semibold tracking-[-0.02em] text-[var(--ink)]">{t("supplyChain.title")}</h2>
           <div className="h-px flex-1 bg-[var(--hairline)]" />
           <AddSourceDialog onCreate={onCreateSource}>
              <Button variant="ghost" size="sm" className="h-8 rounded-xl px-3 text-xs text-[var(--ink-2)] hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink)]">
                 + {t("supplyChain.addSource")}
              </Button>
           </AddSourceDialog>
       </div>

       {sources.length > 0 ? (
         <div className="grid grid-cols-1 gap-4 items-start lg:grid-cols-2 2xl:grid-cols-3">
            {sources.map(source => (
                <SyncSourceCard 
                    key={source.id} 
                    source={source} 
                    onSync={() => onSync(source)}
                />
            ))}
         </div>
       ) : (
         <div className="rounded-[1.5rem] border border-dashed border-[var(--hairline)] bg-[var(--panel-bg)] px-5 py-6 text-sm text-[var(--ink-3)] backdrop-blur-sm">
           当前仅保留本地与手动添加的来源。
         </div>
       )}
    </section>
  )
}
