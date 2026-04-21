"use client"

import { AlertTriangle, ArrowRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/shadcn/button"
import { Badge } from "@/components/ui/shadcn/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/shadcn/sheet"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/shadcn/alert"
import { MCPTool } from "@/types/mcp"

interface ConflictResolutionDialogProps {
  tool: MCPTool | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onResolve: (action: 'keep' | 'update') => void
}

export function ConflictResolutionDialog({ tool, open, onOpenChange, onResolve }: ConflictResolutionDialogProps) {
  const t = useTranslations("mcp")
  if (!tool || !tool.conflict) return null

  const { currentArgs, incomingArgs, warning } = tool.conflict

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full bg-[var(--panel-bg)] text-[var(--ink)] sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-[var(--warn)]">
            <AlertTriangle size={20} /> {t("conflict.title")}
          </SheetTitle>
          <SheetDescription>
            {t("conflict.description", { name: tool.name })}
          </SheetDescription>
        </SheetHeader>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
            {/* Current Version */}
            <div className="rounded-lg border border-[var(--hairline)] bg-[var(--panel-bg-inset)] p-4">
               <div className="flex items-center justify-between mb-3">
                   <span className="text-sm font-medium text-[var(--ink-2)]">{t("conflict.current")}</span>
                   <Badge variant="outline" className="border-[var(--hairline)] text-[var(--ink-3)]">{t("conflict.local")}</Badge>
               </div>
               <div className="overflow-x-auto rounded border border-[var(--hairline)] bg-[var(--panel-bg)] p-3 font-mono text-xs text-[var(--ink-2)]">
                   <div className="select-none text-[var(--ink-4)]"># {t("conflict.argsLabel")}</div>
                   {currentArgs.length > 0 ? currentArgs.map((arg, i) => (
                       <div key={i} className="whitespace-pre-wrap">{arg}</div>
                   )) : <div className="text-[var(--ink-4)] italic">-</div>}
               </div>
            </div>

            {/* Incoming Version */}
            <div className="rounded-lg border border-[var(--info-border)] bg-[var(--info-soft)] p-4">
               <div className="flex items-center justify-between mb-3">
                   <span className="text-sm font-medium text-[var(--info)]">{t("conflict.incoming")}</span>
                   <Badge className="border-[var(--info-border)] bg-[var(--info-soft)] text-[var(--info)] shadow-none hover:bg-[var(--info-soft)]">{t("conflict.upstream")}</Badge>
               </div>
               <div className="overflow-x-auto rounded border border-[var(--info-border)] bg-[var(--panel-bg)] p-3 font-mono text-xs text-[var(--info)]">
                   <div className="select-none opacity-55"># {t("conflict.argsLabel")}</div>
                   {incomingArgs.length > 0 ? incomingArgs.map((arg, i) => {
                       const isNew = !currentArgs.includes(arg)
                       return (
                           <div key={i} className={isNew ? "-mx-1 rounded bg-[var(--ok-soft)] px-1 font-bold text-[var(--ok)]" : "whitespace-pre-wrap"}>
                               {isNew ? "+ " : ""}{arg}
                           </div>
                       )
                   }) : <div className="text-[var(--ink-4)] italic">-</div>}
               </div>
            </div>
        </div>

        {warning && (
            <Alert variant="destructive" className="border-[var(--warn-border)] bg-[var(--warn-soft)] text-[var(--warn)]">
                <AlertTriangle className="h-4 w-4 text-[var(--warn)]" />
                <AlertTitle className="text-[var(--warn)]">{t("conflict.warningTitle")}</AlertTitle>
                <AlertDescription>
                    {warning}
                </AlertDescription>
            </Alert>
        )}

        <SheetFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onResolve('keep')}>
             {t("conflict.keep")}
          </Button>
          <Button 
            className="bg-[var(--ink)] text-[var(--panel-bg)] hover:opacity-90"
            onClick={() => onResolve('update')}
          >
             {t("conflict.update")}
             <ArrowRight size={14} className="ml-2" />
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
