"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"
import { HoverCopyButton, extractTextFromNode } from "@/components/chat/copyable-pre"

export function CodeBlock({
  children,
  className,
  language,
  headerActions,
  editableValue,
  onEditableValueChange,
}: {
  children: React.ReactNode
  className?: string
  language?: string
  headerActions?: React.ReactNode
  editableValue?: string
  onEditableValueChange?: (value: string) => void
}) {
  const t = useI18n("chat")
  const [collapsed, setCollapsed] = useState(false)
  const isEditable =
    typeof editableValue === "string" && typeof onEditableValueChange === "function"
  const rawText = useMemo(
    () => (isEditable ? editableValue : extractTextFromNode(children)),
    [children, editableValue, isEditable]
  )
  const trimmed = rawText.replace(/\n$/, "")
  const lines = useMemo(() => trimmed.split("\n"), [trimmed])
  const label = language || "text"

  return (
    <div className="group rounded-lg border border-border bg-muted/40">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span className="font-medium">{label}</span>
        <div className="flex items-center gap-1">
          {headerActions}
          <HoverCopyButton
            value={rawText}
            className="h-6 w-6 border-transparent bg-transparent shadow-none"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label={collapsed ? t("codeBlock.expand") : t("codeBlock.collapse")}
            onClick={() => setCollapsed((prev) => !prev)}
          >
            {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {collapsed ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          {t("codeBlock.collapsed", { count: lines.length })}
        </div>
      ) : isEditable ? (
        <div className="px-3 py-2">
          <Textarea
            value={editableValue}
            onChange={(event) => onEditableValueChange(event.target.value)}
            spellCheck={false}
            rows={Math.min(Math.max(lines.length, 6), 24)}
            className="min-h-0 resize-y border-0 bg-transparent px-0 py-0 font-mono text-xs leading-5 shadow-none focus-visible:border-transparent focus-visible:ring-0"
          />
        </div>
      ) : (
        <div className="grid grid-cols-[auto_1fr] gap-3 px-3 py-2">
          <div className="select-none text-right text-[11px] leading-5 text-muted-foreground/70">
            {lines.map((_, index) => (
              <div key={`line-${index + 1}`}>{index + 1}</div>
            ))}
          </div>
          <pre className="overflow-auto text-xs font-mono leading-5">
            <code className={cn("font-mono", className)}>{children}</code>
          </pre>
        </div>
      )}
    </div>
  )
}
