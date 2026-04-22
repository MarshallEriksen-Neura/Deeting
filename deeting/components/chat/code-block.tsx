"use client"

import { useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/ui/shadcn/button"
import { Textarea } from "@/ui/shadcn/textarea"
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
  editableTextareaProps,
}: {
  children: React.ReactNode
  className?: string
  language?: string
  headerActions?: React.ReactNode
  editableValue?: string
  onEditableValueChange?: (value: string) => void
  editableTextareaProps?: React.ComponentProps<"textarea">
}) {
  const t = useI18n("chat")
  const [collapsed, setCollapsed] = useState(false)
  const [editorScrollTop, setEditorScrollTop] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isEditable =
    typeof editableValue === "string" && typeof onEditableValueChange === "function"
  const rawText = useMemo(
    () => (isEditable ? editableValue : extractTextFromNode(children)),
    [children, editableValue, isEditable]
  )
  const trimmed = rawText.replace(/\n$/, "")
  const lines = useMemo(() => trimmed.split("\n"), [trimmed])
  const label = language || "text"
  const {
    onKeyDown: externalOnKeyDown,
    onScroll: externalOnScroll,
    className: editableTextareaClassName,
    ...restEditableTextareaProps
  } = editableTextareaProps ?? {}

  const handleEditableKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Tab" && isEditable) {
      event.preventDefault()
      const target = event.currentTarget
      const selectionStart = target.selectionStart ?? 0
      const selectionEnd = target.selectionEnd ?? selectionStart
      const nextValue =
        rawText.slice(0, selectionStart) + "  " + rawText.slice(selectionEnd)
      onEditableValueChange(nextValue)

      requestAnimationFrame(() => {
        const nextPosition = selectionStart + 2
        textareaRef.current?.setSelectionRange(nextPosition, nextPosition)
      })
    }

    externalOnKeyDown?.(event)
  }

  const handleEditableScroll = (event: React.UIEvent<HTMLTextAreaElement>) => {
    setEditorScrollTop(event.currentTarget.scrollTop)
    externalOnScroll?.(event)
  }

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
        <div className="grid grid-cols-[auto_1fr] gap-3 px-3 py-2">
          <div className="select-none overflow-hidden rounded-md border border-border/60 bg-background/35 px-2 py-2 text-right text-[11px] leading-5 text-muted-foreground/70">
            <div
              style={{ transform: `translateY(-${editorScrollTop}px)` }}
              className="transition-transform"
            >
              {lines.map((_, index) => (
                <div key={`editor-line-${index + 1}`}>{index + 1}</div>
              ))}
            </div>
          </div>
          <Textarea
            ref={textareaRef}
            value={editableValue}
            onChange={(event) => onEditableValueChange(event.target.value)}
            onKeyDown={handleEditableKeyDown}
            onScroll={handleEditableScroll}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            wrap="off"
            rows={Math.min(Math.max(lines.length, 6), 24)}
            className={cn(
              "min-h-0 resize-y border-0 bg-transparent px-0 py-0 font-mono text-xs leading-5 shadow-none focus-visible:border-transparent focus-visible:ring-0",
              editableTextareaClassName
            )}
            {...restEditableTextareaProps}
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
