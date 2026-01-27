import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useChatService } from '@/hooks/use-chat-service'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import { useSpecPlanActions, useSpecPlanDetail, useSpecPlanStatus } from '@/lib/swr/use-spec-agent'
import { resolveModelVisual } from '@/components/models/model-picker'

export const useStatusbarState = () => {
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

  const running =
    execution?.status === 'running' || execution?.status === 'waiting'
  useSpecPlanStatus(planId, { enabled: running && !!planId })
  const restoreDetail = useSpecPlanDetail(restorePlanId, {
    enabled: !!restorePlanId,
  })

  useEffect(() => {
    if (!models.length) return
    const exists = plannerModel
      ? models.some((model) => model.id === plannerModel)
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
    if (!restorePlanId || !restoreDetail.error || typeof window === 'undefined') {
      return
    }
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

  return {
    planId,
    projectName,
    execution,
    stats,
    running,
    showLaunch,
    pickerOpen,
    setPickerOpen,
    isLoadingModels,
    modelGroups,
    plannerModel,
    selectedModel,
    modelVisual,
    handleModelChange,
    start,
    startState,
  }
}
