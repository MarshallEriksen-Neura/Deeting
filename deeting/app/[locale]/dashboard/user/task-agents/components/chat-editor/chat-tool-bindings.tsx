"use client"

import * as React from "react"
import { Checkbox } from "@/components/ui/shadcn/checkbox"
import { Skeleton } from "@/components/ui/shadcn/skeleton"
import { cn } from "@/lib/utils"
import type { CustomTaskAgentBindingCatalog } from "@/lib/api/custom-task-agents"
import type { TaskAgentDraft } from "../task-agent-editor-types"
import { BindingPanel } from "./binding-panel"
import { BindingSearchBar } from "./binding-search-bar"
import { statusToneClass } from "./status-tone"

type Translation = (key: string, values?: Record<string, string | number>) => string
type ToolList = CustomTaskAgentBindingCatalog["mcp_tools"]

type ChatToolBindingsProps = {
  t: Translation
  draft: TaskAgentDraft
  bindingCatalog: CustomTaskAgentBindingCatalog
  bindingsLoading: boolean
  filteredBindingTools: ToolList
  toolQuery: string
  showSelectedToolsOnly: boolean
  setToolQuery: (value: string) => void
  setShowSelectedToolsOnly: (updater: (current: boolean) => boolean) => void
  toggleBinding: (kind: "tool" | "skill", identifier: string, checked: boolean) => void
}

export function ChatToolBindings({
  t,
  draft,
  bindingCatalog,
  bindingsLoading,
  filteredBindingTools,
  toolQuery,
  showSelectedToolsOnly,
  setToolQuery,
  setShowSelectedToolsOnly,
  toggleBinding,
}: ChatToolBindingsProps) {
  const groupedTools = React.useMemo(() => {
    const groups = new Map<string, ToolList>()
    for (const tool of filteredBindingTools) {
      const key = tool.server_name || t("bindings.unknownServer")
      const list = groups.get(key)
      if (list) list.push(tool)
      else groups.set(key, [tool])
    }
    return Array.from(groups.entries())
  }, [filteredBindingTools, t])

  return (
    <BindingPanel
      title={t("bindings.toolsTitle")}
      description={t("bindings.toolsDescription")}
      count={draft.callable_mcp_tool_ids.length}
      toolbar={
        <BindingSearchBar
          value={toolQuery}
          onChange={setToolQuery}
          placeholder={t("bindings.searchToolsPlaceholder")}
          showSelectedOnly={showSelectedToolsOnly}
          onToggleSelectedOnly={() =>
            setShowSelectedToolsOnly((current) => !current)
          }
          selectedOnlyLabel={t("bindings.selectedOnly")}
        />
      }
    >
      <div className="space-y-3">
        {bindingsLoading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <div
              key={`tool-skeleton-${index}`}
              className="space-y-2 rounded-xl border border-[var(--hairline)] bg-[var(--panel-bg)]/40 p-3"
            >
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))
        ) : bindingCatalog.mcp_tools.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--muted)]">
            {t("bindings.noTools")}
          </p>
        ) : filteredBindingTools.length === 0 ? (
          <p className="py-8 text-center text-xs text-[var(--muted)]">
            {t("bindings.noFilteredTools")}
          </p>
        ) : (
          groupedTools.map(([serverName, tools]) => (
            <div key={serverName} className="space-y-2">
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-[var(--panel-bg-inset)]/90 backdrop-blur-sm px-1 py-1.5">
                <span className="ws-meta text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--ink-2)]">
                  {serverName}
                </span>
                <span className="ws-num text-[10px] tabular-nums opacity-40">
                  ({tools.length})
                </span>
                <div className="flex-1 h-px bg-[var(--hairline-subtle)]" />
              </div>

              <div className="space-y-2">
                {tools.map((tool) => {
                  const isChecked = draft.callable_mcp_tool_ids.includes(tool.id)
                  return (
                    <label
                      key={tool.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all",
                        isChecked
                          ? "border-[var(--accent-border)] bg-[var(--accent-soft)]/60"
                          : "border-[var(--hairline)] bg-[var(--panel-bg)]/40 hover:bg-[var(--panel-bg)]/70",
                      )}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked) =>
                          toggleBinding("tool", tool.id, checked === true)
                        }
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="ws-control text-sm font-bold text-[var(--ink-1)]">
                            {tool.name}
                          </span>
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                              statusToneClass(tool.status),
                            )}
                          >
                            {tool.status}
                          </span>
                        </div>
                        <p className="ws-body text-xs opacity-70 leading-snug">
                          {tool.description || "-"}
                        </p>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </BindingPanel>
  )
}
