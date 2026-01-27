'use client'

import { memo } from 'react'
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

type NodeDetailModelProps = {
  t: (key: string, params?: Record<string, string>) => string
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

export const NodeDetailModel = memo(function NodeDetailModel({
  t,
  isAction,
  selectedModel,
  setSelectedModel,
  isSaving,
  isLoadingModels,
  isUnknownModel,
  modelGroups,
  updateError,
}: NodeDetailModelProps) {
  const AUTO_VALUE = '__auto__'

  return (
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
          <SelectItem value={AUTO_VALUE}>{t('node.modal.modelAuto')}</SelectItem>
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
        <p className="text-xs text-destructive">{t('node.modal.saveFailed')}</p>
      )}
    </div>
  )
})
