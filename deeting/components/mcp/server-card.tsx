"use client"

import { Terminal, Lock, Settings, AlertCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { MCPTool, MCPToolStatus } from "@/types/mcp"

interface ServerCardProps {
  tool: MCPTool
  onToggle?: (id: string, enabled: boolean) => void
  onClick?: () => void
  onResolveConflict?: () => void
}

const StatusIndicator = ({ status }: { status: MCPToolStatus }) => {
    switch(status) {
        case 'running': 
          return <div className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </div>
        case 'degraded': return <div className="h-2 w-2 rounded-full bg-orange-400" />
        case 'crashed': return <div className="h-2 w-2 rounded-full bg-red-500" />
        case 'starting': return <div className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse" />
        case 'updating': return <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
        case 'stopped': 
        default:
          return <div className="h-2 w-2 rounded-full border border-gray-300" />
    }
}

export function ServerCard({ tool, onToggle, onClick, onResolveConflict }: ServerCardProps) {
  const isSynced = tool.source !== 'local'
  const isRunning = tool.status === 'running' || tool.status === 'degraded'
  
  return (
    <Card 
      onClick={(e) => {
          // Prevent triggering card click when clicking interactive elements
          if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('[role="switch"]')) return;
          onClick?.()
      }}
      className={cn(
       "group relative overflow-hidden transition-all duration-200 hover:shadow-md cursor-pointer border bg-white",
       tool.conflict ? "border-amber-300 bg-amber-50/10" : "border-gray-200"
      )}
    >
       <div className="p-5 flex flex-col gap-4">
          
          {/* Header */}
          <div className="flex justify-between items-start">
             <div className="flex items-center gap-3">
                <div className={cn(
                    "p-2 rounded-lg border shadow-sm",
                    isSynced ? "bg-purple-50/50 border-purple-100 text-purple-600" : "bg-white border-gray-100 text-gray-600"
                )}>
                   <Terminal size={18} />
                </div>
                <div>
                   <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{tool.name}</h3>
                      {/* Status Badges */}
                      {tool.conflict && (
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-amber-200 bg-amber-50 text-amber-700 gap-1 animate-pulse cursor-pointer hover:bg-amber-100" onClick={(e) => {
                              e.stopPropagation();
                              onResolveConflict?.();
                          }}>
                              <AlertCircle size={10} /> Conflict
                          </Badge>
                      )}
                      {isSynced && !tool.conflict && (
                         <Badge variant="secondary" className="text-[10px] h-5 bg-purple-50 text-purple-700 px-1.5 border border-purple-100">
                            Synced
                         </Badge>
                      )}
                      {!isSynced && (
                          <Badge variant="outline" className="text-[10px] h-5 text-gray-500 px-1.5 border-gray-200">
                             Local
                          </Badge>
                      )}
                   </div>
                   <p className="text-xs text-gray-500 font-mono mt-0.5">ID: {tool.id}</p>
                </div>
             </div>
             
             {/* Actions */}
             <div className="flex items-center gap-3">
                <Switch 
                  checked={isRunning || tool.status === 'starting'} 
                  onCheckedChange={(checked) => onToggle?.(tool.id, checked)}
                  disabled={tool.status === 'updating'}
                  className="data-[state=checked]:bg-black"
                />
                <Button size="icon" variant="ghost" className="h-8 w-8 text-gray-400 hover:text-gray-900">
                   {isSynced ? <Lock size={14} /> : <Settings size={14} />}
                </Button>
             </div>
          </div>

          {/* Description */}
          <div className="min-h-[2.5em]">
            <p className="text-sm text-gray-600 line-clamp-2">
              {tool.description}
            </p>
            {tool.status === 'crashed' && tool.error && (
                <span className="block mt-2 text-red-600 font-mono text-xs bg-red-50 border border-red-100 p-1.5 rounded">
                   Error: {tool.error}
                </span>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-between items-center pt-3 border-t border-gray-50 mt-auto">
             <div className="flex gap-1.5 flex-wrap">
                {tool.capabilities.map(cap => (
                   <span key={cap} className="text-[10px] bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded border border-gray-100 font-mono">
                      {cap}
                   </span>
                ))}
             </div>
             
             <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                         <div className="flex items-center gap-2 text-xs font-mono text-gray-400 hover:text-gray-600 transition-colors bg-gray-50/50 px-2 py-1 rounded-full border border-gray-100">
                            <StatusIndicator status={tool.status} />
                            {tool.status === 'running' ? tool.ping : tool.status}
                         </div>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Status: {tool.status}</p>
                        {tool.ping !== '-' && <p>Latency: {tool.ping}</p>}
                    </TooltipContent>
                </Tooltip>
             </TooltipProvider>
          </div>

       </div>
    </Card>
  )
}