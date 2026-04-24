"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/shadcn/button"
import { SyncSourceCard } from "./sync-source-card"
import { MCPSource } from "@/types/mcp"
import { cn } from "@/lib/utils"
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
  const [expanded, setExpanded] = useState(false)

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex items-center gap-2 transition-colors hover:text-[var(--ink)]"
          onClick={() => setExpanded(!expanded)}
        >
          <h2 className="ws-pane-title">{t("supplyChain.title")}</h2>
          <ChevronDown
            size={14}
            className={cn(
              "text-[var(--ink-3)] transition-transform duration-[var(--dur-fast)] ease-[var(--ease-standard)]",
              expanded && "rotate-180"
            )}
          />
        </button>
        <div className="h-px flex-1 bg-[var(--hairline)]" />
        {expanded && (
          <AddSourceDialog onCreate={onCreateSource}>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-[var(--r-8)] px-3 text-[12px] text-[var(--ink-2)] hover:bg-[var(--panel-bg-inset)] hover:text-[var(--ink)]"
            >
              + {t("supplyChain.addSource")}
            </Button>
          </AddSourceDialog>
        )}
      </div>

      {expanded && (
        sources.length > 0 ? (
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
          <div className="rounded-[var(--r-14)] border border-dashed border-[var(--hairline)] bg-[var(--panel-bg)] px-5 py-6 text-[13px] text-[var(--ink-3)]">
            当前仅保留本地与手动添加的来源。
          </div>
        )
      )}
    </section>
  )
}
