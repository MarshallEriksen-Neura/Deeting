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
  showChatContentCompatibility?: boolean
  onTest: (model: ProviderModel) => void
  onToggleActive: (model: ProviderModel, active: boolean) => void
  onUpdateAlias: (model: ProviderModel, alias: string) => void
  onSave?: (model: ProviderModel, payload: ProviderModelUpdate) => Promise<void>
  onPurchase?: (model: ProviderModel) => Promise<void> | void
  readOnly?: boolean
  purchasingModelUuid?: string | null
}

export const ModelAccordion = React.memo(function ModelAccordion({
  models,
  showChatContentCompatibility = false,
  onTest,
  onToggleActive,
  onUpdateAlias,
  onSave,
  onPurchase,
  readOnly = false,
  purchasingModelUuid = null,
}: ModelAccordionProps) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null)

  const handleRowClick = React.useCallback((model: ProviderModel) => {
    if (readOnly || model.is_locked) return
    setExpandedId((prev) => (prev === model.id ? null : model.id))
  }, [readOnly])

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
              onPurchase={onPurchase}
              onRowClick={handleRowClick}
              isExpanded={isExpanded}
              readOnly={readOnly}
              isPurchasing={purchasingModelUuid === model.uuid}
            />
            <AnimatePresence initial={false}>
              {isExpanded && !readOnly && !model.is_locked && (
                <CollapsibleContent forceMount className="px-2 pb-3">
                  <motion.div
                    key={`${model.id}-panel`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                  >
                    <ModelConfigPanel
                      model={model}
                      showChatContentCompatibility={showChatContentCompatibility}
                      onSave={onSave}
                    />
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
