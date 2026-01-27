'use client'

import { memo } from 'react'
import { ChevronDown, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GlassButton } from '@/components/ui/glass-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ModelPicker, resolveModelVisual } from '@/components/models/model-picker'

type ModelGroup = {
  instance_id: string
  instance_name: string
  provider?: string
  models: Array<{ id: string; owned_by?: string }>
}

type ModelVisual = ReturnType<typeof resolveModelVisual>

export const StatusControls = memo(function StatusControls({
  t,
  pickerOpen,
  setPickerOpen,
  isLoadingModels,
  modelGroups,
  plannerModel,
  selectedModel,
  modelVisual,
  onModelChange,
  showLaunch,
  launching,
  running,
  start,
  startLoading,
}: {
  t: (key: string) => string
  pickerOpen: boolean
  setPickerOpen: (open: boolean) => void
  isLoadingModels: boolean
  modelGroups: ModelGroup[]
  plannerModel: string | null
  selectedModel: { model: { id: string }; group?: ModelGroup } | null
  modelVisual: ModelVisual
  onModelChange: (modelId: string) => void
  showLaunch: boolean
  launching: boolean
  running: boolean
  start: () => Promise<unknown>
  startLoading: boolean
}) {
  const ModelIcon = modelVisual.icon

  return (
    <div className="flex items-center gap-3">
      <div className="hidden md:flex items-center gap-2">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <GlassButton
              variant="outline"
              className="h-9 px-3 gap-3 text-left"
              disabled={isLoadingModels || modelGroups.length === 0}
            >
              <span className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/70 text-xs shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] dark:bg-white/10 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
                  <ModelIcon className={`h-4 w-4 ${modelVisual.color}`} />
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {selectedModel?.model.id ?? '--'}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {selectedModel?.group?.provider ||
                      selectedModel?.model.owned_by ||
                      ''}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    pickerOpen ? 'rotate-180' : ''
                  }`}
                />
              </span>
            </GlassButton>
          </PopoverTrigger>
          <PopoverContent
            className="w-[min(520px,92vw)] p-0"
            align="start"
            side="bottom"
            sideOffset={10}
          >
            <ModelPicker
              value={plannerModel ?? undefined}
              onChange={onModelChange}
              modelGroups={modelGroups}
              valueField="id"
              showHeader={false}
              searchPlaceholder={t('statusbar.modelSearchPlaceholder')}
              emptyText={t('statusbar.modelEmpty')}
              noResultsText={t('statusbar.modelNoResults')}
              disabled={isLoadingModels || modelGroups.length === 0}
              scrollAreaClassName="h-64 pr-1"
              className="rounded-2xl border border-white/10"
            />
          </PopoverContent>
        </Popover>
      </div>
      {showLaunch ? (
        <Button
          size="sm"
          variant="default"
          onClick={() => void start()}
          disabled={startLoading || launching}
        >
          <Play className="w-3 h-3" />
          {launching ? t('statusbar.running') : t('statusbar.launch')}
        </Button>
      ) : (
        <Button size="sm" variant="secondary" disabled>
          <Play className="w-3 h-3" />
          {running ? t('statusbar.running') : t('statusbar.ready')}
        </Button>
      )}
    </div>
  )
})
