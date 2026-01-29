'use client'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  FileCode,
  GitGraph,
} from 'lucide-react'
import type { Layout, PanelImperativeHandle } from 'react-resizable-panels'

import { Button } from '@/components/ui/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useI18n } from '@/hooks/use-i18n'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import { FileChangesPanel } from './file-changes-panel'

interface SpecAgentSplitLayoutProps {
  console: ReactNode
  canvas: ReactNode
}

type RightPanelView = 'fileChanges' | 'canvas'

export function SpecAgentSplitLayout({
  console,
  canvas,
}: SpecAgentSplitLayoutProps) {
  const consolePanelId = 'spec-agent-console'
  const canvasPanelId = 'spec-agent-canvas'
  const t = useI18n('spec-agent')
  const layout = useSpecAgentStore((state) => state.layout)
  const setLayout = useSpecAgentStore((state) => state.setLayout)
  const consolePanelRef = useRef<PanelImperativeHandle>(null)
  const canvasPanelRef = useRef<PanelImperativeHandle>(null)
  const consoleCollapsedRef = useRef(layout.consoleCollapsed)
  const canvasCollapsedRef = useRef(layout.canvasCollapsed)
  const lastSizesRef = useRef({
    consoleSize: layout.consoleSize,
    canvasSize: layout.canvasSize,
  })
  const initializedRef = useRef(false)

  // 右侧面板视图切换：默认显示文件变更
  const [rightPanelView, setRightPanelView] = useState<RightPanelView>('fileChanges')

  useEffect(() => {
    consoleCollapsedRef.current = layout.consoleCollapsed
  }, [layout.consoleCollapsed])

  useEffect(() => {
    canvasCollapsedRef.current = layout.canvasCollapsed
  }, [layout.canvasCollapsed])

  useEffect(() => {
    lastSizesRef.current = {
      consoleSize: layout.consoleSize,
      canvasSize: layout.canvasSize,
    }
  }, [layout.consoleSize, layout.canvasSize])

  const syncConsoleCollapsed = useCallback(
    (collapsed: boolean) => {
      const shouldForceCanvasExpand = collapsed && canvasCollapsedRef.current
      if (!shouldForceCanvasExpand && collapsed === consoleCollapsedRef.current) return
      setLayout({
        consoleCollapsed: collapsed,
        ...(collapsed ? { canvasCollapsed: false } : null),
      })
      if (shouldForceCanvasExpand) {
        canvasPanelRef.current?.expand()
      }
    },
    [setLayout]
  )

  const syncCanvasCollapsed = useCallback(
    (collapsed: boolean) => {
      const shouldForceConsoleExpand = collapsed && consoleCollapsedRef.current
      if (!shouldForceConsoleExpand && collapsed === canvasCollapsedRef.current) return
      setLayout({
        canvasCollapsed: collapsed,
        ...(collapsed ? { consoleCollapsed: false } : null),
      })
      if (shouldForceConsoleExpand) {
        consolePanelRef.current?.expand()
      }
    },
    [setLayout]
  )

  const collapseConsole = useCallback(() => {
    consolePanelRef.current?.collapse()
    syncConsoleCollapsed(true)
  }, [syncConsoleCollapsed])

  const expandConsole = useCallback(() => {
    consolePanelRef.current?.expand()
    syncConsoleCollapsed(false)
  }, [syncConsoleCollapsed])

  const collapseCanvas = useCallback(() => {
    canvasPanelRef.current?.collapse()
    syncCanvasCollapsed(true)
  }, [syncCanvasCollapsed])

  const expandCanvas = useCallback(() => {
    canvasPanelRef.current?.expand()
    syncCanvasCollapsed(false)
  }, [syncCanvasCollapsed])

  const handleConsoleResize = useCallback(() => {
    const collapsed = consolePanelRef.current?.isCollapsed() ?? false
    syncConsoleCollapsed(collapsed)
  }, [syncConsoleCollapsed])

  const handleCanvasResize = useCallback(() => {
    const collapsed = canvasPanelRef.current?.isCollapsed() ?? false
    syncCanvasCollapsed(collapsed)
  }, [syncCanvasCollapsed])

  const handleLayoutChanged = useCallback(
    (sizes: Layout) => {
      const nextConsoleSize = sizes[consolePanelId]
      const nextCanvasSize = sizes[canvasPanelId]
      if (!Number.isFinite(nextConsoleSize) || !Number.isFinite(nextCanvasSize)) {
        return
      }
      if (!(nextConsoleSize > 0 && nextCanvasSize > 0)) return
      lastSizesRef.current = {
        consoleSize: nextConsoleSize,
        canvasSize: nextCanvasSize,
      }
      setLayout({
        consoleSize: nextConsoleSize,
        canvasSize: nextCanvasSize,
      })
    },
    [canvasPanelId, consolePanelId, setLayout]
  )

  const resolvedSizes = useMemo(() => {
    const consoleSize = Number.isFinite(layout.consoleSize)
      ? layout.consoleSize
      : 55
    const canvasSize = Number.isFinite(layout.canvasSize)
      ? layout.canvasSize
      : 45
    const total = consoleSize + canvasSize
    if (total <= 0) return { consoleSize: 55, canvasSize: 45 }
    return {
      consoleSize: (consoleSize / total) * 100,
      canvasSize: (canvasSize / total) * 100,
    }
  }, [layout.canvasSize, layout.consoleSize])

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    if (layout.consoleCollapsed) {
      consolePanelRef.current?.collapse()
    }
    if (layout.canvasCollapsed) {
      canvasPanelRef.current?.collapse()
    }
  }, [layout.canvasCollapsed, layout.consoleCollapsed])

  useEffect(() => {
    if (!layout.consoleCollapsed || !layout.canvasCollapsed) return
    setLayout({ canvasCollapsed: false })
    canvasPanelRef.current?.expand()
  }, [layout.canvasCollapsed, layout.consoleCollapsed, setLayout])

  return (
    <div className="flex-1 relative overflow-hidden">
      <ResizablePanelGroup
        direction="horizontal"
        className="h-full"
        onLayoutChanged={handleLayoutChanged}
      >
        <ResizablePanel
          id={consolePanelId}
          panelRef={consolePanelRef}
          defaultSize={resolvedSizes.consoleSize}
          minSize={20}
          collapsedSize={0}
          collapsible
          onResize={handleConsoleResize}
          className="min-w-0"
        >
          <div className="relative h-full bg-card">
            {!layout.consoleCollapsed && (
              <div className="absolute right-2 top-2 z-20">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-xl bg-muted/30 hover:bg-muted/50 border border-border/30 shadow-sm backdrop-blur transition-colors"
                  onClick={collapseConsole}
                >
                  <PanelLeftClose className="h-4 w-4" />
                  <span className="sr-only">{t('layout.consoleClose')}</span>
                </Button>
              </div>
            )}
            <div className="h-full">{console}</div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel
          id={canvasPanelId}
          panelRef={canvasPanelRef}
          defaultSize={resolvedSizes.canvasSize}
          minSize={30}
          collapsedSize={0}
          collapsible
          onResize={handleCanvasResize}
          className="min-w-0"
        >
          <div className="relative h-full bg-card flex flex-col">
            {/* 视图切换标签 - 精致毛玻璃风格 */}
            {!layout.canvasCollapsed && (
              <div className="flex-shrink-0 px-3 py-2.5 border-b border-border/30 bg-card/80 backdrop-blur-sm flex items-center justify-between">
                <Tabs value={rightPanelView} onValueChange={(v) => setRightPanelView(v as RightPanelView)}>
                  <TabsList className="h-9 p-1 bg-muted/30 border border-border/30 rounded-xl">
                    <TabsTrigger
                      value="fileChanges"
                      className="text-xs gap-1.5 px-3.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground transition-all duration-200"
                    >
                      <FileCode className="h-3.5 w-3.5" />
                      {t('fileChanges.title')}
                    </TabsTrigger>
                    <TabsTrigger
                      value="canvas"
                      className="text-xs gap-1.5 px-3.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground transition-all duration-200"
                    >
                      <GitGraph className="h-3.5 w-3.5" />
                      {t('layout.canvasTab')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-xl bg-muted/30 hover:bg-muted/50 border border-border/30 shadow-sm transition-colors"
                  onClick={collapseCanvas}
                >
                  <PanelRightClose className="h-4 w-4" />
                  <span className="sr-only">{t('layout.canvasClose')}</span>
                </Button>
              </div>
            )}
            {/* 内容区域 */}
            <div className="flex-1 overflow-hidden">
              {rightPanelView === 'fileChanges' ? (
                <FileChangesPanel />
              ) : (
                canvas
              )}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {layout.consoleCollapsed && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-2 top-1/2 z-20 h-9 w-9 -translate-y-1/2 rounded-xl bg-card/90 hover:bg-card border border-border/30 shadow-md backdrop-blur transition-colors"
          onClick={expandConsole}
        >
          <PanelLeftOpen className="h-4 w-4" />
          <span className="sr-only">{t('layout.consoleOpen')}</span>
        </Button>
      )}

      {layout.canvasCollapsed && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-1/2 z-20 h-9 w-9 -translate-y-1/2 rounded-xl bg-card/90 hover:bg-card border border-border/30 shadow-md backdrop-blur transition-colors"
          onClick={expandCanvas}
        >
          <PanelRightOpen className="h-4 w-4" />
          <span className="sr-only">{t('layout.canvasOpen')}</span>
        </Button>
      )}
    </div>
  )
}
