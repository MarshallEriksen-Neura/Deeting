'use client'

import { memo } from 'react'
import { History, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConsoleHistorySheet } from './console-history-sheet'
import { CodeModeExecutionSheet } from '../../components/code-mode-execution-sheet'
import type { SpecPlanListItem } from '@/lib/api/spec-agent'
import { useI18n } from '@/hooks/use-i18n'

type ConsoleHeaderProps = {
  title: string
  historyLabel: string
  historyOpen: boolean
  onHistoryOpenChange: (open: boolean) => void
  items: SpecPlanListItem[]
  isLoading: boolean
  isLoadingMore: boolean
  hasMore: boolean
  loadingPlanId: string | null
  historyError: string | null
  onLoadMore: () => void
  onSelectPlan: (planId: string) => void
  resolvePlanStatus: (status: string) => string
}

export const ConsoleHeader = memo(function ConsoleHeader({
  title,
  historyLabel,
  historyOpen,
  onHistoryOpenChange,
  items,
  isLoading,
  isLoadingMore,
  hasMore,
  loadingPlanId,
  historyError,
  onLoadMore,
  onSelectPlan,
  resolvePlanStatus,
}: ConsoleHeaderProps) {
  const t = useI18n('spec-agent')

  return (
    <div className="flex-shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <div className="flex items-center gap-1">
        <CodeModeExecutionSheet
          trigger={
            <Button variant="ghost" size="sm" className="gap-1.5">
              <Terminal className="w-4 h-4" />
              {t('codeMode.title')}
            </Button>
          }
        />
        <ConsoleHistorySheet
        open={historyOpen}
        onOpenChange={onHistoryOpenChange}
        items={items}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        loadingPlanId={loadingPlanId}
        historyError={historyError}
        onLoadMore={onLoadMore}
        onSelectPlan={onSelectPlan}
        resolvePlanStatus={resolvePlanStatus}
        trigger={
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => onHistoryOpenChange(true)}
          >
            <History className="w-4 h-4" />
            {historyLabel}
          </Button>
        }
      />
      </div>
    </div>
  )
})
