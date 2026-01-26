"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, Clock, DollarSign, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { GlassButton } from '@/components/ui/glass-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ModelPicker, resolveModelVisual } from '@/components/models/model-picker'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import { useSpecPlanActions, useSpecPlanDetail, useSpecPlanStatus } from '@/lib/swr/use-spec-agent'
import { useI18n } from '@/hooks/use-i18n'
import { useChatService } from '@/hooks/use-chat-service'

export default function StatusBar() {
  const t = useI18n('spec-agent')
  const planId = useSpecAgentStore((state) => state.planId)
  const projectName = useSpecAgentStore((state) => state.projectName)
  const nodes = useSpecAgentStore((state) => state.nodes)
  const execution = useSpecAgentStore((state) => state.execution)
  const drafting = useSpecAgentStore((state) => state.drafting)
  const plannerModel = useSpecAgentStore((state) => state.plannerModel)
  const setPlannerModel = useSpecAgentStore((state) => state.setPlannerModel)
  const { start, startState } = useSpecPlanActions(planId)
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { modelGroups, models, isLoadingModels } = useChatService({
    modelCapability: 'chat',
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [restorePlanId, setRestorePlanId] = useState<string | null>(null)
  const queryPlanId = useMemo(
    () => searchParams?.get('plan')?.trim() || null,
    [searchParams]
  )

  const running = execution?.status === 'running' || execution?.status === 'waiting'
  useSpecPlanStatus(planId, { enabled: running && !!planId })
  const restoreDetail = useSpecPlanDetail(restorePlanId, {
    enabled: !!restorePlanId,
  })

  useEffect(() => {
    if (!models.length) return
    const exists = plannerModel
      ? models.some(
          (model) =>
            model.id === plannerModel
        )
      : false
    if (!exists) {
      setPlannerModel(models[0].id)
    }
  }, [models, plannerModel, setPlannerModel])

  useEffect(() => {
    if (!planId || typeof window === 'undefined') return
    localStorage.setItem('deeting-spec-agent:last-plan', planId)
  }, [planId])

  useEffect(() => {
    if (planId) return
    if (typeof window === 'undefined') return
    const stored = localStorage.getItem('deeting-spec-agent:last-plan')
    const candidate = queryPlanId || stored
    if (!candidate || candidate === restorePlanId) return
    setRestorePlanId(candidate)
  }, [planId, queryPlanId, restorePlanId])

  useEffect(() => {
    if (!planId || !pathname) return
    const params = new URLSearchParams(searchParams?.toString())
    if (params.get('plan') === planId) return
    params.set('plan', planId)
    const next = params.toString()
    router.replace(next ? `${pathname}?${next}` : pathname)
  }, [planId, pathname, router, searchParams])

  useEffect(() => {
    if (!restorePlanId || !restoreDetail.error || typeof window === 'undefined') return
    const params = new URLSearchParams(searchParams?.toString())
    if (params.get('plan') === restorePlanId) {
      params.delete('plan')
      const next = params.toString()
      router.replace(next ? `${pathname}?${next}` : pathname)
    }
    localStorage.removeItem('deeting-spec-agent:last-plan')
    setRestorePlanId(null)
  }, [restoreDetail.error, restorePlanId, pathname, router, searchParams])

  const handleModelChange = useCallback(
    (modelId: string) => {
      setPlannerModel(modelId)
      setPickerOpen(false)
    },
    [setPlannerModel]
  )

  const selectedModel = useMemo(() => {
    if (!plannerModel) return null
    for (const group of modelGroups) {
      const model = group.models.find((item) => item.id === plannerModel)
      if (model) return { model, group }
    }
    return null
  }, [modelGroups, plannerModel])

  const modelVisual = resolveModelVisual(selectedModel?.model)
  const ModelIcon = modelVisual.icon

  const stats = useMemo(() => {
    const total = nodes.length
    const completed = nodes.filter((node) => node.status === 'completed').length
    const active = nodes.filter((node) => node.status === 'active').length
    const error = nodes.filter((node) => node.status === 'error').length
    const progress =
      execution?.progress ??
      (total ? Math.min(100, Math.round((completed / total) * 100)) : 0)
    return { total, completed, active, error, progress }
  }, [execution?.progress, nodes])

  const showLaunch =
    planId &&
    drafting.status === 'ready' &&
    (!execution || execution.status === 'drafting')

  return (
    <div className="h-12 px-4 flex items-center justify-between bg-card border-b border-border">
      {/* 左侧：项目信息 */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {t('statusbar.project')}
          </span>
          <span className="text-sm text-muted-foreground">
            {projectName ?? t('statusbar.projectPlaceholder')}
          </span>
        </div>
      </div>

      {/* 中间：进度和状态 */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span>
            {execution?.status
              ? t(`statusbar.status.${execution.status}`)
              : t('statusbar.status.drafting')}
          </span>
        </div>

        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <DollarSign className="w-4 h-4" />
          <span>{t('statusbar.costPlaceholder')}</span>
        </div>

        <div className="flex items-center gap-2">
          <Progress value={stats.progress} className="w-32" />
          <span className="text-xs text-muted-foreground">{stats.progress}%</span>
        </div>

        <div className="text-sm text-muted-foreground">
          {t('statusbar.nodes', { completed: stats.completed, total: stats.total })}
        </div>
      </div>

      {/* 右侧：模型与控制按钮 */}
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
                      {selectedModel?.model.id ?? "--"}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {selectedModel?.group?.provider || selectedModel?.model.owned_by || ""}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <ChevronDown className={`h-4 w-4 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
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
                onChange={handleModelChange}
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
          <Button size="sm" variant="default" onClick={() => void start()} disabled={startState.isMutating}>
            <Play className="w-3 h-3" />
            {t('statusbar.launch')}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled>
            <Play className="w-3 h-3" />
            {running ? t('statusbar.running') : t('statusbar.ready')}
          </Button>
        )}
      </div>
    </div>
  )
}
