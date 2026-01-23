"use client"

import type { ReactNode } from "react"
import { memo } from "react"
import { useShallow } from "zustand/react/shallow"
import { cn } from "@/lib/utils"
import { useWorkspaceStore } from "@/store/workspace-store"

interface WorkspaceShellProps {
  children: ReactNode
  workspace: ReactNode
}

/**
 * WorkspaceShell Component
 * 
 * 工作区外壳组件，提供主内容区和侧边工作区的布局。
 * 
 * 性能优化：
 * - 使用 React.memo 避免不必要的重渲染
 * - 使用 useShallow 优化 Zustand store 订阅
 * 
 * @param children - 主内容区
 * @param workspace - 侧边工作区内容
 */
export const WorkspaceShell = memo<WorkspaceShellProps>(function WorkspaceShell({
  children,
  workspace,
}) {
  const hasViews = useWorkspaceStore(
    useShallow((state) => state.views.length > 0)
  )

  return (
    <div className="grid h-screen w-screen grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">{children}</div>
      <aside
        className={cn(
          "h-screen border-l bg-background transition-all duration-300",
          hasViews
            ? "w-[40%] min-w-[400px] max-w-[720px]"
            : "w-0 overflow-hidden pointer-events-none"
        )}
        aria-hidden={!hasViews}
      >
        <div className="h-full w-full">{workspace}</div>
      </aside>
    </div>
  )
})
