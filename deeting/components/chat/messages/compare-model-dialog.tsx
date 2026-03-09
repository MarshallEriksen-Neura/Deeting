"use client"

import * as React from "react"
import { Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useI18n } from "@/hooks/use-i18n"
import type { ModelInfo } from "@/lib/api/models"
import { resolveModelVisual } from "@/components/models/model-picker"

interface CompareModelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  models: ModelInfo[]
  excludedModelKeys: string[]
  onSelect: (modelValue: string) => void
}

export function CompareModelDialog({
  open,
  onOpenChange,
  models,
  excludedModelKeys,
  onSelect,
}: CompareModelDialogProps) {
  const t = useI18n("chat")
  const [query, setQuery] = React.useState("")

  const filteredModels = React.useMemo(() => {
    const blocked = new Set(excludedModelKeys)
    const keyword = query.trim().toLowerCase()
    return models.filter((model) => {
      const modelKey = model.provider_model_id ?? model.id
      if (blocked.has(modelKey)) return false
      if (model.request_route !== "local_invoke" && model.runtime_source !== "desktop_local") {
        return false
      }
      if (!keyword) return true
      return [model.id, model.provider_model_id, model.owned_by]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(keyword))
    })
  }, [excludedModelKeys, models, query])

  React.useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("compare.dialog.title")}</DialogTitle>
          <DialogDescription>{t("compare.dialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("compare.dialog.searchPlaceholder")}
            className="pl-9"
          />
        </div>

        <div className="max-h-[24rem] space-y-2 overflow-y-auto pr-1">
          {filteredModels.length ? (
            filteredModels.map((model) => {
              const modelValue = model.provider_model_id ?? model.id
              const visual = resolveModelVisual(model)
              const Icon = visual.icon
              return (
                <Button
                  key={modelValue}
                  type="button"
                  variant="outline"
                  className="h-auto w-full justify-start rounded-xl px-3 py-3 text-left"
                  onClick={() => {
                    onSelect(modelValue)
                    onOpenChange(false)
                  }}
                >
                  <span className="mr-3 flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                    <Icon className={`h-4 w-4 ${visual.color}`} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{model.id}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {model.provider_model_id ?? model.owned_by ?? t("compare.dialog.localModel")}
                    </span>
                  </span>
                </Button>
              )
            })
          ) : (
            <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {models.length ? t("compare.dialog.empty") : t("compare.dialog.noModels")}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}