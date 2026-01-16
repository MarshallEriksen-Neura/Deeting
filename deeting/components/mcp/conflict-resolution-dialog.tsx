"use client"

import { AlertTriangle, ArrowRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { MCPTool } from "@/types/mcp"

interface ConflictResolutionDialogProps {
  tool: MCPTool | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onResolve: (action: 'keep' | 'update') => void
}

export function ConflictResolutionDialog({ tool, open, onOpenChange, onResolve }: ConflictResolutionDialogProps) {
  if (!tool || !tool.conflict) return null
  const t = useTranslations("mcp")

  const { currentArgs, incomingArgs, warning } = tool.conflict

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle size={20} /> {t("conflict.title")}
          </SheetTitle>
          <SheetDescription>
            {t("conflict.description", { name: tool.name })}
          </SheetDescription>
        </SheetHeader>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
            {/* Current Version */}
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
               <div className="flex items-center justify-between mb-3">
                   <span className="text-sm font-medium text-gray-700">{t("conflict.current")}</span>
                   <Badge variant="outline" className="text-gray-500 border-gray-300">{t("conflict.local")}</Badge>
               </div>
               <div className="font-mono text-xs text-gray-600 bg-white p-3 rounded border border-gray-100 overflow-x-auto">
                   <div className="text-gray-400 select-none"># {t("conflict.argsLabel")}</div>
                   {currentArgs.length > 0 ? currentArgs.map((arg, i) => (
                       <div key={i} className="whitespace-pre-wrap">{arg}</div>
                   )) : <div className="text-gray-400 italic">-</div>}
               </div>
            </div>

            {/* Incoming Version */}
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
               <div className="flex items-center justify-between mb-3">
                   <span className="text-sm font-medium text-blue-900">{t("conflict.incoming")}</span>
                   <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200 shadow-none">{t("conflict.upstream")}</Badge>
               </div>
               <div className="font-mono text-xs text-blue-800 bg-white p-3 rounded border border-blue-100 overflow-x-auto">
                   <div className="text-blue-300 select-none"># {t("conflict.argsLabel")}</div>
                   {incomingArgs.length > 0 ? incomingArgs.map((arg, i) => {
                       const isNew = !currentArgs.includes(arg)
                       return (
                           <div key={i} className={isNew ? "text-green-600 font-bold bg-green-50 px-1 -mx-1 rounded" : "whitespace-pre-wrap"}>
                               {isNew ? "+ " : ""}{arg}
                           </div>
                       )
                   }) : <div className="text-gray-400 italic">-</div>}
               </div>
            </div>
        </div>

        {warning && (
            <Alert variant="destructive" className="bg-orange-50 text-orange-800 border-orange-200">
                <AlertTriangle className="h-4 w-4 text-orange-600" />
                <AlertTitle className="text-orange-900">{t("conflict.warningTitle")}</AlertTitle>
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
            className="bg-black text-white hover:bg-gray-800"
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
