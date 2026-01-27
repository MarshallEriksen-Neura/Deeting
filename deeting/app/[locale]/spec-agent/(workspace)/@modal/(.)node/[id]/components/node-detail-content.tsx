'use client'

import { memo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import type { SpecUiNode } from '@/store/spec-agent-store'
import type { SpecNode } from '@/lib/api/spec-agent'

type NodeDetailContentProps = {
  t: (key: string, params?: Record<string, string>) => string
  node: SpecUiNode | undefined
  rawNode: SpecNode | undefined
  isAction: boolean
  selectedModel: string
  setSelectedModel: (value: string) => void
  isSaving: boolean
  isLoadingModels: boolean
  isUnknownModel: boolean
  modelGroups: Array<{
    instance_id: string
    instance_name: string
    provider?: string
    models: Array<{ id: string; owned_by?: string }>
  }>
  updateError: boolean
}

export const NodeDetailContent = memo(function NodeDetailContent({
  t,
  node,
  rawNode,
  isAction,
  selectedModel,
  setSelectedModel,
  isSaving,
  isLoadingModels,
  isUnknownModel,
  modelGroups,
  updateError,
}: NodeDetailContentProps) {
  const AUTO_VALUE = '__auto__'

  if (!node) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {t('node.modal.notFound')}
      </div>
    )
  }

  return (
    <ScrollArea className="h-[calc(100vh-14rem)] pr-1">
      <div className="space-y-4 pr-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {t('node.modal.fields.type')}
            </Label>
            <p className="text-sm text-foreground">
              {rawNode?.type === 'logic_gate'
                ? t('canvas.node.type.logic')
                : rawNode?.type === 'replan_trigger'
                  ? t('canvas.node.type.replan')
                  : t('canvas.node.type.action')}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {t('node.modal.fields.status')}
            </Label>
            <Badge variant="outline">
              {t(`node.modal.status.${node.status}`)}
            </Badge>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {t('node.modal.fields.duration')}
            </Label>
            <p className="text-sm text-foreground">
              {node.duration ?? t('node.modal.durationPlaceholder')}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {t('node.modal.fields.title')}
            </Label>
            <p className="text-sm text-foreground">{node.title}</p>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <Label className="text-xs text-muted-foreground">
            {t('node.modal.fields.model')}
          </Label>
          <Select
            value={selectedModel}
            onValueChange={setSelectedModel}
            disabled={!isAction || isSaving || isLoadingModels}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder={t('node.modal.modelPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_VALUE}>
                {t('node.modal.modelAuto')}
              </SelectItem>
              <SelectSeparator />
              {isUnknownModel && (
                <SelectItem value={selectedModel}>
                  {t('node.modal.modelUnknown', { model: selectedModel })}
                </SelectItem>
              )}
              {modelGroups.map((group) => (
                <SelectGroup key={group.instance_id}>
                  <SelectLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {group.instance_name}
                  </SelectLabel>
                  {group.models.map((model) => {
                    const modelValue = model.id
                    return (
                      <SelectItem key={modelValue} value={modelValue}>
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-foreground">
                            {model.id}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {group.provider || model.owned_by || 'provider'}
                          </span>
                        </div>
                      </SelectItem>
                    )
                  })}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {isAction ? t('node.modal.modelHint') : t('node.modal.modelDisabled')}
          </p>
          {updateError && (
            <p className="text-xs text-destructive">
              {t('node.modal.saveFailed')}
            </p>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            {t('node.modal.fields.payload')}
          </Label>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto font-mono">
            {JSON.stringify(rawNode ?? {}, null, 2)}
          </pre>
        </div>
      </div>
    </ScrollArea>
  )
})
