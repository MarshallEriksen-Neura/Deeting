'use client'

import { memo, ReactNode } from 'react'
import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import type { SpecPlanListItem } from '@/lib/api/spec-agent'
import { useI18n } from '@/hooks/use-i18n'

type ConsoleHistorySheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: SpecPlanListItem[]
  isLoading: boolean
  isLoadingMore: boolean
  hasMore: boolean
  loadingPlanId: string | null
  historyError: string | null
  onLoadMore: () => void
  onSelectPlan: (planId: string) => void
  resolvePlanStatus: (status: string) => string
  trigger: ReactNode
}

export const ConsoleHistorySheet = memo(function ConsoleHistorySheet({
  open,
  onOpenChange,
  items,
  isLoading,
  isLoadingMore,
  hasMore,
  loadingPlanId,
  historyError,
  onLoadMore,
  onSelectPlan,
  resolvePlanStatus,
  trigger,
}: ConsoleHistorySheetProps) {
  const t = useI18n('spec-agent')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger}
      <SheetContent side="left" className="w-[360px] p-0">
        <SheetHeader className="px-4 py-4 border-b border-border">
          <SheetTitle>{t('history.title')}</SheetTitle>
          <SheetDescription>{t('history.subtitle')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col h-full">
          <ScrollArea className="flex-1 px-2 py-3">
            <div className="space-y-2">
              {isLoading && items.length === 0 && (
                <div className="text-sm text-muted-foreground px-3 py-2">
                  {t('history.loading')}
                </div>
              )}
              {!isLoading && items.length === 0 && (
                <div className="text-sm text-muted-foreground px-3 py-2">
                  {t('history.empty')}
                </div>
              )}
              {historyError && (
                <div className="text-sm text-destructive px-3 py-2">
                  {historyError}
                </div>
              )}
              {items.map((plan) => {
                const statusKey = resolvePlanStatus(plan.status)
                return (
                  <Button
                    key={plan.id}
                    variant="ghost"
                    className="w-full justify-between px-3 py-3 h-auto rounded-xl border border-transparent hover:border-border"
                    onClick={() => void onSelectPlan(plan.id)}
                    disabled={loadingPlanId === plan.id}
                  >
                    <span className="flex flex-col items-start gap-1 text-left">
                      <span className="text-sm font-medium text-foreground">
                        {plan.project_name || t('history.untitled')}
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-2">
                        <Clock className="w-3 h-3" />
                        {new Date(plan.updated_at).toLocaleString()}
                      </span>
                    </span>
                    <Badge
                      variant={
                        statusKey === 'error' ? 'destructive' : 'secondary'
                      }
                    >
                      {t(`statusbar.status.${statusKey}`)}
                    </Badge>
                  </Button>
                )
              })}
            </div>
          </ScrollArea>
          <div className="px-4 py-3 border-t border-border">
            <Button
              variant="outline"
              className="w-full"
              disabled={!hasMore || isLoadingMore}
              onClick={onLoadMore}
            >
              {hasMore ? t('history.loadMore') : t('history.noMore')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
})
