"use client"

import { useMemo } from 'react'
import { Clock, DollarSign, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import { useSpecPlanActions, useSpecPlanStatus } from '@/lib/swr/use-spec-agent'
import { useI18n } from '@/hooks/use-i18n'

export default function StatusBar() {
  const t = useI18n('spec-agent')
  const planId = useSpecAgentStore((state) => state.planId)
  const projectName = useSpecAgentStore((state) => state.projectName)
  const nodes = useSpecAgentStore((state) => state.nodes)
  const execution = useSpecAgentStore((state) => state.execution)
  const drafting = useSpecAgentStore((state) => state.drafting)
  const { start, startState } = useSpecPlanActions(planId)

  const running = execution?.status === 'running' || execution?.status === 'waiting'
  useSpecPlanStatus(planId, { enabled: running && !!planId })

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

      {/* 右侧：控制按钮 */}
      <div className="flex items-center gap-2">
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
