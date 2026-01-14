"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { AnimatePresence, motion } from "framer-motion"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"

import { ModelDataStrip } from "./model-matrix"
import type { ProviderModel } from "./types"
import type { ProviderModelUpdate } from "@/lib/api/providers"

const ModelConfigPanel = dynamic(
  () => import("./model-config-panel").then((m) => m.ModelConfigPanel),
  { ssr: false, loading: () => null }
)

interface ModelAccordionProps {
  models: ProviderModel[]
  onTest: (model: ProviderModel) => void
  onToggleActive: (model: ProviderModel, active: boolean) => void
  onUpdateAlias: (model: ProviderModel, alias: string) => void
  onSave?: (model: ProviderModel, payload: ProviderModelUpdate) => Promise<void>
}

export const ModelAccordion = React.memo(function ModelAccordion({
  models,
  onTest,
  onToggleActive,
  onUpdateAlias,
  onSave,
}: ModelAccordionProps) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null)

  const handleRowClick = React.useCallback((model: ProviderModel) => {
    setExpandedId((prev) => (prev === model.id ? null : model.id))
  }, [])

  const handleOpenChange = React.useCallback(
    (modelId: string, open: boolean) => {
      setExpandedId(open ? modelId : null)
    },
    []
  )

  return (
    <div className="space-y-2">
      {models.map((model, index) => {
        const isExpanded = expandedId === model.id
        return (
          <Collapsible
            key={model.id}
            open={isExpanded}
            onOpenChange={(open) => handleOpenChange(model.id, open)}
          >
            <ModelDataStrip
              model={model}
              index={index}
              onTest={onTest}
              onToggleActive={onToggleActive}
              onUpdateAlias={onUpdateAlias}
              onRowClick={handleRowClick}
              isExpanded={isExpanded}
            />
            <AnimatePresence initial={false}>
              {isExpanded && (
                <CollapsibleContent forceMount className="px-2 pb-3">
                  <motion.div
                    key={`${model.id}-panel`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                  >
                    <ModelConfigPanel model={model} onSave={onSave} />
                  </motion.div>
                </CollapsibleContent>
              )}
            </AnimatePresence>
          </Collapsible>
        )
      })}
    </div>
  )
})
