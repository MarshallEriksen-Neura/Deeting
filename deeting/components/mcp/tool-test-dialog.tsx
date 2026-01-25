import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useNotifications } from "@/components/contexts/notification-context"
import type { MCPTool } from "@/types/mcp"

interface ToolTestDialogProps {
  tool: MCPTool | null
  open: boolean
  onOpenChange: (open: boolean) => void
  loading?: boolean
  result?: unknown
  logs?: string[]
  traceId?: string | null
  onTest: (args: Record<string, unknown>) => void
}

export function ToolTestDialog({
  tool,
  open,
  onOpenChange,
  loading,
  result,
  logs,
  traceId,
  onTest,
}: ToolTestDialogProps) {
  const t = useTranslations("mcp")
  const { addNotification } = useNotifications()
  const [argsText, setArgsText] = useState("{}")

  useEffect(() => {
    if (!open) return
    setArgsText("{}")
  }, [open, tool?.id])

  const formattedResult = useMemo(() => {
    if (result === undefined) return ""
    try {
      return JSON.stringify(result, null, 2)
    } catch {
      return String(result)
    }
  }, [result])

  const formattedLogs = useMemo(() => (logs?.length ? logs.join("\n") : ""), [logs])

  if (!tool) return null

  const handleRun = () => {
    if (!argsText.trim()) {
      onTest({})
      return
    }
    try {
      const parsed = JSON.parse(argsText)
      if (parsed && typeof parsed === "object") {
        onTest(parsed as Record<string, unknown>)
      } else {
        addNotification({
          type: "warning",
          title: t("test.invalidJson"),
          description: "",
          timestamp: Date.now(),
        })
      }
    } catch (err) {
      addNotification({
        type: "warning",
        title: t("test.invalidJson"),
        description: String(err),
        timestamp: Date.now(),
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("test.title", { name: tool.name })}</DialogTitle>
          <DialogDescription>{t("test.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--foreground)]">
              {t("test.fields.arguments")}
            </label>
            <Textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              rows={6}
              placeholder={t("test.placeholders.arguments")}
            />
          </div>

          {traceId && (
            <div className="text-xs text-[var(--muted)]">
              {t("test.trace")}: {traceId}
            </div>
          )}

          {formattedResult && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--foreground)]">
                {t("test.result")}
              </label>
              <Textarea value={formattedResult} readOnly rows={6} />
            </div>
          )}

          {formattedLogs && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--foreground)]">
                {t("test.logs")}
              </label>
              <Textarea value={formattedLogs} readOnly rows={6} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("test.actions.close")}
          </Button>
          <Button onClick={handleRun} disabled={loading}>
            {loading ? t("test.actions.running") : t("test.actions.run")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
