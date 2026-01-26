'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useChatService } from '@/hooks/use-chat-service'
import { useI18n } from '@/hooks/use-i18n'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import { useSpecPlanNodeUpdate } from '@/lib/swr/use-spec-agent'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

interface NodeDetailModalProps {
  params: {
    id: string
  }
}

export default function NodeDetailModal({ params }: NodeDetailModalProps) {
  const router = useRouter()
  const t = useI18n('spec-agent')
  const planId = useSpecAgentStore((state) => state.planId)
  const node = useSpecAgentStore((state) =>
    state.nodes.find((item) => item.id === params.id)
  )
  const { modelGroups, isLoadingModels } = useChatService({
    modelCapability: 'chat',
  })
  const { update, updateState } = useSpecPlanNodeUpdate(planId)

  const rawNode = node?.raw
  const isAction = rawNode?.type === 'action'
  const currentOverride = isAction ? node?.modelOverride ?? null : null
  const AUTO_VALUE = '__auto__'
  const [selectedModel, setSelectedModel] = useState(
    currentOverride ?? AUTO_VALUE
  )

  const handleClose = () => {
    router.back()
  }

  useEffect(() => {
    setSelectedModel(currentOverride ?? AUTO_VALUE)
  }, [AUTO_VALUE, currentOverride, params.id])

  const knownModelValues = useMemo(() => {
    const values = new Set<string>()
    modelGroups.forEach((group) => {
      group.models.forEach((model) => {
        values.add(model.id)
      })
    })
    return values
  }, [modelGroups])

  const isUnknownModel =
    selectedModel !== AUTO_VALUE && !knownModelValues.has(selectedModel)

  const nextOverride = selectedModel === AUTO_VALUE ? null : selectedModel
  const isDirty = nextOverride !== currentOverride
  const isSaving = updateState.isMutating

  const handleSave = async () => {
    if (!planId || !isAction || !node) return
    await update(node.id, nextOverride)
  }

  return (
    <Dialog open={true} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>
            {t('node.modal.title', { id: params.id })}
          </DialogTitle>
        </DialogHeader>

        {!node ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t('node.modal.notFound')}
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <div className="space-y-4 pr-4">
              {/* 基本信息 */}
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

              {/* 模型配置 */}
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
                  {isAction
                    ? t('node.modal.modelHint')
                    : t('node.modal.modelDisabled')}
                </p>
                {updateState.error && (
                  <p className="text-xs text-destructive">
                    {t('node.modal.saveFailed')}
                  </p>
                )}
              </div>

              <Separator />

              {/* 节点数据快照 */}
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
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={handleClose}>
            {t('node.modal.close')}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!node || !isAction || !isDirty || isSaving}
          >
            {isSaving ? t('node.modal.saving') : t('node.modal.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
