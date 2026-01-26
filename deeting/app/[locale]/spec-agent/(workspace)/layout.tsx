import { ReactNode } from 'react'

import { SpecAgentSidebar } from './components/spec-agent-sidebar'
import { SpecAgentSplitLayout } from './components/spec-agent-split-layout'

interface SpecAgentLayoutProps {
  statusbar: ReactNode
  console: ReactNode
  canvas: ReactNode
  modal: ReactNode
}

export default function SpecAgentLayout({
  statusbar,
  console,
  canvas,
  modal
}: SpecAgentLayoutProps) {
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
