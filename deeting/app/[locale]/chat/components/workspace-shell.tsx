"use client"

import type { ReactNode } from "react"
import { useShallow } from "zustand/react/shallow"
import { cn } from "@/lib/utils"
import { useWorkspaceStore } from "@/store/workspace-store"

export function WorkspaceShell({
  children,
  workspace,
}: {
  children: ReactNode
  workspace: ReactNode
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
}
