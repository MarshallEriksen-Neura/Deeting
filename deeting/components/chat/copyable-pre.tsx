"use client"

import { useMemo, useState } from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "@/ui/shadcn/button"
import { useI18n } from "@/hooks/use-i18n"
import { cn } from "@/lib/utils"

export function extractTextFromNode(node: React.ReactNode): string {
  if (node == null) return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(extractTextFromNode).join("")
  if (typeof node === "object" && "props" in node) {
    const maybeElement = node as { props?: { children?: React.ReactNode } }
    return extractTextFromNode(maybeElement.props?.children)
  }
  return ""
}

export function HoverCopyButton({
  value,
  className,
}: {
  value: string
  className?: string
}) {
  const t = useI18n("chat")
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "h-7 w-7 rounded-md border border-border/60 bg-background/80 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-opacity hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
        className
      )}
      aria-label={copied ? t("codeBlock.copied") : t("codeBlock.copy")}
      onClick={handleCopy}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  )
}

export function CopyablePre({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const rawText = useMemo(() => extractTextFromNode(children), [children])

  return (
    <div className="group relative mt-3">
      <HoverCopyButton value={rawText} className="absolute right-2 top-2 z-10" />
      <pre
        className={cn(
          "!my-0 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/60 p-3 pr-11 text-xs font-mono",
          className
        )}
      >
        {children}
      </pre>
    </div>
  )
}
