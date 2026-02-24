'use client'

import { memo, useState, useCallback } from 'react'
import {
  Clock,
  Terminal,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  FlaskConical,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useI18n } from '@/hooks/use-i18n'
import { useCodeModeExecutions } from '@/lib/swr/use-code-mode-executions'
import type { CodeModeExecutionItem } from '@/lib/api/code-mode'
import { CodeModeExecutionDetailDrawer } from './code-mode-execution-detail'

function statusIcon(status: string) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
    case 'failed':
      return <AlertCircle className="w-3.5 h-3.5 text-destructive" />
    case 'dry_run':
      return <FlaskConical className="w-3.5 h-3.5 text-amber-500" />
    default:
      return <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
  }
}

function statusVariant(status: string): 'destructive' | 'secondary' | 'default' {
  if (status === 'failed') return 'destructive'
  return 'secondary'
}

export const CodeModeExecutionSheet = memo(function CodeModeExecutionSheet({
  trigger,
}: {
  trigger: React.ReactNode
}) {
  const t = useI18n('spec-agent')
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const {
    items,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
  } = useCodeModeExecutions({ size: 20 }, { enabled: open })

  const handleSelect = useCallback((item: CodeModeExecutionItem) => {
    setSelectedId(item.id)
  }, [])

  const handleBack = useCallback(() => {
    setSelectedId(null)
  }, [])

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="left" className="w-[400px] p-0">
          <SheetHeader className="px-4 py-4 border-b border-border">
            <SheetTitle>{t('codeMode.title')}</SheetTitle>
            <SheetDescription>{t('codeMode.subtitle')}</SheetDescription>
          </SheetHeader>

          <div className="flex flex-col h-[calc(100%-80px)]">
            <ScrollArea className="flex-1 px-2 py-3">
              <div className="space-y-1.5">
                {isLoading && items.length === 0 && (
                  <div className="text-sm text-muted-foreground px-3 py-6 text-center">
                    {t('codeMode.loading')}
                  </div>
                )}
                {!isLoading && items.length === 0 && !error && (
                  <div className="text-sm text-muted-foreground px-3 py-6 text-center">
                    {t('codeMode.empty')}
                  </div>
                )}
                {error && (
                  <div className="text-sm text-destructive px-3 py-2">
                    {t('codeMode.loadFailed')}
                  </div>
                )}

                {items.map((item) => (
                  <button
                    key={item.id}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-200 hover:bg-muted/50 cursor-pointer group"
                    onClick={() => handleSelect(item)}
                  >
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
                      {statusIcon(item.status)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-foreground/80 truncate group-hover:text-foreground transition-colors">
                          {item.execution_id}
                        </span>
                        <Badge variant={statusVariant(item.status)} className="text-[10px] px-1.5 py-0">
                          {t(`codeMode.status.${item.status}` as Parameters<typeof t>[0])}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {item.created_at
                            ? new Date(item.created_at).toLocaleString()
                            : '—'}
                        </span>
                        <span className="text-[11px] text-muted-foreground/60">
                          {item.duration_ms}ms
                        </span>
                        {item.tool_call_count > 0 && (
                          <span className="text-[11px] text-muted-foreground/60 flex items-center gap-0.5">
                            <Wrench className="w-3 h-3" />
                            {item.tool_call_count}
                          </span>
                        )}
                      </div>
                    </div>

                    <ChevronRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-foreground/60 transition-colors flex-shrink-0" />
                  </button>
                ))}
              </div>
            </ScrollArea>

            <div className="px-4 py-3 border-t border-border">
              <Button
                variant="outline"
                className="w-full"
                disabled={!hasMore || isLoadingMore}
                onClick={loadMore}
              >
                {hasMore ? t('codeMode.loadMore') : t('codeMode.noMore')}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <CodeModeExecutionDetailDrawer
        executionId={selectedId}
        open={!!selectedId}
        onClose={handleBack}
      />
    </>
  )
})
