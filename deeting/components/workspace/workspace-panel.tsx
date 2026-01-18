"use client"

import { X } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"
import { useWorkspaceStore } from "@/store/workspace-store"
import { WorkspaceViewRenderer } from "./workspace-view-renderer"

export function WorkspacePanel() {
  const t = useI18n("chat")
  const { views, activeViewId, switchView, closeView } = useWorkspaceStore(
    useShallow((state) => ({
      views: state.views,
      activeViewId: state.activeViewId,
      switchView: state.switchView,
      closeView: state.closeView,
    }))
  )

  if (views.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        {t("workspace.emptyTitle")}
      </div>
    )
  }

  const resolvedActiveId = activeViewId ?? views[views.length - 1]?.id

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b bg-background/80 backdrop-blur">
        <ScrollArea className="w-full">
          <div className="flex items-center gap-2 p-2">
            {views.map((view) => {
              const isActive = view.id === resolvedActiveId
              return (
                <div
                  key={view.id}
                  className={cn(
                    "flex items-center gap-1 rounded-md border px-1.5 py-1 transition-colors",
                    isActive
                      ? "border-border bg-muted/70 text-foreground"
                      : "border-transparent bg-transparent text-muted-foreground hover:bg-muted/40"
                  )}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => switchView(view.id)}
                  >
                    <span className="max-w-[140px] truncate">{view.title}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    aria-label={t("workspace.closeView")}
                    onClick={(event) => {
                      event.stopPropagation()
                      closeView(view.id)
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {views.map((view) => {
          const isActive = view.id === resolvedActiveId
          return (
            <div
              key={view.id}
              className={cn(
                "absolute inset-0 h-full w-full bg-background",
                isActive
                  ? "z-10 visible opacity-100"
                  : "z-0 invisible opacity-0 pointer-events-none"
              )}
              aria-hidden={!isActive}
            >
              <WorkspaceViewRenderer view={view} active={isActive} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
