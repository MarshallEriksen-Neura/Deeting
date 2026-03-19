'use client'

import { memo, useMemo, useState, useCallback } from 'react'
import {
  ArrowLeft,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  Code2,
  Wrench,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useI18n } from '@/hooks/use-i18n'
import { useCodeModeExecutionDetail } from '@/lib/swr/use-code-mode-executions'
import {
  extractToolTraces,
  replayCodeModeExecution,
  type RuntimeToolTrace,
} from '@/lib/api/code-mode'

function runtimeVariant(runtimeMode?: string): 'secondary' | 'outline' | 'default' {
  if (runtimeMode === 'sandbox') return 'default'
  return 'outline'
}

// ── Tool trace item ─────────────────────────────────────────

const ToolTraceItem = memo(function ToolTraceItem({
  trace,
  index,
  t,
}: {
  trace: RuntimeToolTrace
  index: number
  t: (key: string) => string
}) {
  const [expanded, setExpanded] = useState(false)
  const hasError = !!trace.error

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-muted/50 transition-colors">
          <span className="flex-shrink-0 w-5 h-5 rounded bg-muted flex items-center justify-center text-[10px] font-mono text-muted-foreground">
            {index + 1}
          </span>
          <Wrench className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium text-foreground truncate flex-1">
            {trace.tool_name}
          </span>
          {hasError && (
            <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
          )}
          {trace.duration_ms != null && (
            <span className="text-[11px] text-muted-foreground/60 flex-shrink-0">
              {trace.duration_ms}ms
            </span>
          )}
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-7 mr-2 mb-2 space-y-2">
          {trace.arguments && Object.keys(trace.arguments).length > 0 && (
            <div>
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                {t('codeMode.detail.toolArgs')}
              </span>
              <pre className="mt-1 text-xs bg-muted/40 rounded-md p-2 overflow-x-auto max-h-40 text-foreground/80">
                {JSON.stringify(trace.arguments, null, 2)}
              </pre>
            </div>
          )}
          {trace.error && (
            <div>
              <span className="text-[11px] font-medium text-destructive uppercase tracking-wide">
                {t('codeMode.detail.toolError')}
              </span>
              <pre className="mt-1 text-xs bg-destructive/10 rounded-md p-2 overflow-x-auto max-h-40 text-destructive">
                {trace.error}
              </pre>
            </div>
          )}
          {trace.result !== undefined && !trace.error && (
            <div>
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                {t('codeMode.detail.toolResult')}
              </span>
              <pre className="mt-1 text-xs bg-muted/40 rounded-md p-2 overflow-x-auto max-h-40 text-foreground/80">
                {typeof trace.result === 'string'
                  ? trace.result
                  : JSON.stringify(trace.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
})

// ── Main detail drawer ──────────────────────────────────────

export const CodeModeExecutionDetailDrawer = memo(
  function CodeModeExecutionDetailDrawer({
    executionId,
    open,
    onClose,
  }: {
    executionId: string | null
    open: boolean
    onClose: () => void
  }) {
    const t = useI18n('spec-agent')
    const [replaying, setReplaying] = useState(false)
    const [replayResult, setReplayResult] = useState<'success' | 'failed' | null>(null)

    const { data: detail, isLoading } = useCodeModeExecutionDetail(
      executionId,
      { enabled: open && !!executionId }
    )
    const codePreview =
      typeof detail?.runtime_context?.code === 'string'
        ? detail.runtime_context.code
        : '—'

    const toolTraces = useMemo(() => {
      if (!detail) return []
      return extractToolTraces(detail)
    }, [detail])

    const handleReplay = useCallback(async () => {
      if (!executionId) return
      setReplaying(true)
      setReplayResult(null)
      try {
        await replayCodeModeExecution(executionId)
        setReplayResult('success')
      } catch {
        setReplayResult('failed')
      } finally {
        setReplaying(false)
      }
    }, [executionId])

    return (
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="right" className="w-[520px] p-0">
          <SheetHeader className="px-4 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <SheetTitle className="text-base">
                {t('codeMode.detail.title')}
              </SheetTitle>
            </div>
          </SheetHeader>

          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {detail && (
            <ScrollArea className="h-[calc(100%-65px)]">
              <div className="p-4 space-y-4">
                {/* Meta info */}
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge
                    variant={detail.status === 'failed' ? 'destructive' : 'secondary'}
                  >
                    {detail.status === 'success' && (
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                    )}
                    {detail.status === 'failed' && (
                      <AlertCircle className="w-3 h-3 mr-1" />
                    )}
                    {t(`codeMode.status.${detail.status}` as Parameters<typeof t>[0])}
                  </Badge>
                  {detail.runtime_mode ? (
                    <Badge variant={runtimeVariant(detail.runtime_mode)}>
                      {t(`codeMode.runtimeMode.${detail.runtime_mode}` as Parameters<typeof t>[0])}
                    </Badge>
                  ) : null}
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {detail.duration_ms}ms
                  </span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {detail.execution_id}
                  </span>
                </div>

                {/* Error */}
                {detail.error && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                    <span className="text-xs font-medium text-destructive">
                      {detail.error_code || 'ERROR'}
                    </span>
                    <p className="text-sm text-destructive mt-1">{detail.error}</p>
                  </div>
                )}

                {/* Code */}
                <Collapsible defaultOpen={toolTraces.length === 0}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors">
                      <Code2 className="w-4 h-4" />
                      {t('codeMode.detail.code')}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre className="mt-2 text-xs bg-muted/40 rounded-lg p-3 overflow-x-auto max-h-60 font-mono text-foreground/80 whitespace-pre-wrap">
                      {codePreview}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>

                {/* Tool call trace */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Wrench className="w-4 h-4 text-foreground" />
                    <span className="text-sm font-medium text-foreground">
                      {t('codeMode.detail.toolTrace')}
                    </span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {toolTraces.length}
                    </Badge>
                  </div>

                  {toolTraces.length === 0 ? (
                    <p className="text-sm text-muted-foreground pl-6">
                      {t('codeMode.detail.noTrace')}
                    </p>
                  ) : (
                    <div className="space-y-0.5">
                      {toolTraces.map((trace, i) => (
                        <ToolTraceItem
                          key={`${trace.tool_name}-${i}`}
                          trace={trace}
                          index={i}
                          t={t}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Render blocks */}
                {detail.render_blocks &&
                  typeof detail.render_blocks === 'object' &&
                  Object.keys(detail.render_blocks).length > 0 && (
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground/80 transition-colors">
                          <Code2 className="w-4 h-4" />
                          {t('codeMode.detail.renderBlocks')}
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <pre className="mt-2 text-xs bg-muted/40 rounded-lg p-3 overflow-x-auto max-h-60 font-mono text-foreground/80">
                          {JSON.stringify(detail.render_blocks, null, 2)}
                        </pre>
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                {/* Replay button */}
                <div className="pt-2 border-t border-border">
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    disabled={replaying}
                    onClick={handleReplay}
                  >
                    {replaying ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    {replaying
                      ? t('codeMode.detail.replaying')
                      : t('codeMode.detail.replay')}
                  </Button>
                  {replayResult === 'success' && (
                    <p className="text-xs text-emerald-600 mt-1.5 text-center">
                      {t('codeMode.detail.replaySuccess')}
                    </p>
                  )}
                  {replayResult === 'failed' && (
                    <p className="text-xs text-destructive mt-1.5 text-center">
                      {t('codeMode.detail.replayFailed')}
                    </p>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>
    )
  }
)
