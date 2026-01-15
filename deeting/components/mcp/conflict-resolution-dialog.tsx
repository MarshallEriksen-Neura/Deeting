"use client"

import { AlertTriangle, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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

  const { currentArgs, incomingArgs, warning } = tool.conflict

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle size={20} /> Configuration Conflict Detected
          </DialogTitle>
          <DialogDescription>
            The upstream configuration for <strong>{tool.name}</strong> has changed. Review the differences below.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-4">
            {/* Current Version */}
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
               <div className="flex items-center justify-between mb-3">
                   <span className="text-sm font-medium text-gray-700">Current (v1)</span>
                   <Badge variant="outline" className="text-gray-500 border-gray-300">Local</Badge>
               </div>
               <div className="font-mono text-xs text-gray-600 bg-white p-3 rounded border border-gray-100 overflow-x-auto">
                   <div className="text-gray-400 select-none"># Args</div>
                   {currentArgs.map((arg, i) => (
                       <div key={i} className="whitespace-pre-wrap">{arg}</div>
                   ))}
               </div>
            </div>

            {/* Incoming Version */}
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
               <div className="flex items-center justify-between mb-3">
                   <span className="text-sm font-medium text-blue-900">Incoming (v2)</span>
                   <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200 shadow-none">Upstream</Badge>
               </div>
               <div className="font-mono text-xs text-blue-800 bg-white p-3 rounded border border-blue-100 overflow-x-auto">
                   <div className="text-blue-300 select-none"># Args</div>
                   {incomingArgs.map((arg, i) => {
                       const isNew = !currentArgs.includes(arg)
                       return (
                           <div key={i} className={isNew ? "text-green-600 font-bold bg-green-50 px-1 -mx-1 rounded" : "whitespace-pre-wrap"}>
                               {isNew ? "+ " : ""}{arg}
                           </div>
                       )
                   })}
               </div>
            </div>
        </div>

        {warning && (
            <Alert variant="destructive" className="bg-orange-50 text-orange-800 border-orange-200">
                <AlertTriangle className="h-4 w-4 text-orange-600" />
                <AlertTitle className="text-orange-900">Security Warning</AlertTitle>
                <AlertDescription>
                    {warning}
                </AlertDescription>
            </Alert>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onResolve('keep')}>
             Keep Local Version
          </Button>
          <Button 
            className="bg-black text-white hover:bg-gray-800"
            onClick={() => onResolve('update')}
          >
             Update & Restart
             <ArrowRight size={14} className="ml-2" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
