'use client'

import { memo } from 'react'
import { History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConsoleHistorySheet } from './console-history-sheet'
import type { SpecPlanListItem } from '@/lib/api/spec-agent'

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
  return (
    <div className="flex-shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
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
  )
})
