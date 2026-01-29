'use client'

import type { ReactNode } from 'react'
import { useSpecAgentStore } from '@/store/spec-agent-store'
import { SpecAgentSidebar } from './spec-agent-sidebar'
import { SpecAgentSplitLayout } from './spec-agent-split-layout'
import { WelcomeView } from './welcome-view'
import { TaskHistorySidebar } from './task-history-sidebar'

interface WorkspaceContentProps {
  statusbar: ReactNode
  console: ReactNode
  canvas: ReactNode
  modal: ReactNode
}

export function WorkspaceContent({
  statusbar,
  console,
  canvas,
  modal
}: WorkspaceContentProps) {
  const planId = useSpecAgentStore((state) => state.planId)
  const draftingStatus = useSpecAgentStore((state) => state.drafting.status)

  // 欢迎态：没有计划且不在 drafting 状态
  const isWelcomeState = planId === null && draftingStatus === 'idle'

  if (isWelcomeState) {
    return (
      <div className="h-screen flex bg-background">
        <SpecAgentSidebar />
        <TaskHistorySidebar />
        <div className="flex-1 overflow-hidden">
          <WelcomeView />
        </div>
        {modal}
      </div>
    )
  }

  // 执行态：有计划或正在 drafting
  return (
    <div className="h-screen flex flex-col bg-background">
      {/* 顶部状态栏 */}
      <div className="flex-shrink-0 border-b border-border">
        {statusbar}
      </div>

      {/* 主体区域：Nav + Console + Canvas */}
      <div className="flex-1 flex overflow-hidden">
        <SpecAgentSidebar />
        <SpecAgentSplitLayout console={console} canvas={canvas} />
      </div>

      {/* 模态层 */}
      {modal}
    </div>
  )
}
