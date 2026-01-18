"use client"

import { useMemo, useState } from "react"
import { Copy, Check, ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useI18n } from "@/hooks/use-i18n"

function extractText(node: React.ReactNode): string {
  if (node == null) return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractText).join("")
  if (typeof node === "object" && "props" in node) {
    const maybeElement = node as { props?: { children?: React.ReactNode } }
    return extractText(maybeElement.props?.children)
  }
  return ""
}

export function CodeBlock({
  children,
  className,
  language,
}: {
  children: React.ReactNode
  className?: string
  language?: string
}) {
  const t = useI18n("chat")
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const rawText = useMemo(() => extractText(children), [children])
  const trimmed = rawText.replace(/\n$/, "")
  const lines = useMemo(() => trimmed.split("\n"), [trimmed])
  const label = language || "text"

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(rawText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-muted/40">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span className="font-medium">{label}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label={copied ? t("codeBlock.copied") : t("codeBlock.copy")}
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
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
