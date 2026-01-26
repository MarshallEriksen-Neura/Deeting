import { ReactNode } from 'react'

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

      {/* 主体区域：Console + Canvas */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧对话流 */}
        <div className="w-96 flex-shrink-0 border-r border-border bg-card">
          {console}
        </div>

        {/* 右侧任务画布 */}
        <div className="flex-1 relative bg-surface">
          {canvas}
        </div>
      </div>

      {/* 模态层 */}
      {modal}
    </div>
  )
}