"use client"

import { Terminal, Lock, Settings, AlertCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { GlassButton } from "@/components/ui/glass-button"
import { GlassCard } from "@/components/ui/glass-card"
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
          return <div className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-sm shadow-emerald-500/50"></span>
          </div>
        case 'degraded': return <div className="h-2.5 w-2.5 rounded-full bg-orange-400 shadow-sm shadow-orange-400/50" />
        case 'crashed': return <div className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm shadow-red-500/50" />
        case 'starting': return <div className="h-2.5 w-2.5 rounded-full bg-yellow-400 animate-pulse shadow-sm shadow-yellow-400/50" />
        case 'updating': return <div className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse shadow-sm shadow-blue-500/50" />
        case 'stopped':
        default:
          return <div className="h-2.5 w-2.5 rounded-full border-2 border-gray-300" />
    }
}

export function ServerCard({ tool, onToggle, onClick, onResolveConflict }: ServerCardProps) {
  const isSynced = tool.source !== 'local'
  const isRunning = tool.status === 'running' || tool.status === 'degraded'

  return (
    <GlassCard
      onClick={(e: React.MouseEvent<HTMLDivElement>) => {
          // Prevent triggering card click when clicking interactive elements
          if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('[role="switch"]')) return;
          onClick?.()
      }}
      blur="lg"
      theme={tool.conflict ? "primary" : "default"}
      hover="lift"
      padding="none"
      className={cn(
       "group cursor-pointer transition-all duration-300",
       tool.conflict && "ring-2 ring-amber-400/30"
      )}
    >
       <div className="p-6 flex flex-col gap-4">
          
          {/* Header */}
          <div className="flex justify-between items-start">
             <div className="flex items-center gap-3">
                <div className={cn(
                    "p-2.5 rounded-xl backdrop-blur-sm transition-all duration-200",
                    isSynced
                      ? "bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-400/20 text-purple-600 shadow-lg shadow-purple-500/10"
                      : "bg-white/40 border border-white/20 text-gray-600 shadow-sm"
                )}>
                   <Terminal size={18} strokeWidth={2} />
                </div>
                <div>
                   <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{tool.name}</h3>
                      {/* Status Badges */}
                      {tool.conflict && (
                          <Badge
                            variant="outline"
                            className="text-[10px] h-6 px-2 border-amber-400/50 bg-gradient-to-r from-amber-50 to-orange-50 text-amber-700 gap-1.5 animate-pulse cursor-pointer hover:bg-amber-100 transition-all shadow-sm shadow-amber-500/20"
                            onClick={(e) => {
                              e.stopPropagation();
                              onResolveConflict?.();
                          }}>
                              <AlertCircle size={11} /> Conflict
                          </Badge>
                      )}
                      {isSynced && !tool.conflict && (
                         <Badge variant="secondary" className="text-[10px] h-6 bg-gradient-to-r from-purple-50 to-indigo-50 text-purple-700 px-2 border border-purple-200/50 shadow-sm">
                            Synced
                         </Badge>
                      )}
                      {!isSynced && (
                          <Badge variant="outline" className="text-[10px] h-6 text-gray-500 px-2 border-gray-300/50 bg-white/50">
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
                  className="data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-purple-600 data-[state=checked]:to-purple-500"
                />
                <GlassButton
                  size="icon-sm"
                  variant="ghost"
                  className="text-gray-400 hover:text-gray-900"
                >
                   {isSynced ? <Lock size={14} /> : <Settings size={14} />}
                </GlassButton>
             </div>
          </div>

          {/* Description */}
          <div className="min-h-[2.5em]">
            <p className="text-sm text-gray-600 line-clamp-2">
              {tool.description}
            </p>
            {tool.status === 'crashed' && tool.error && (
                <div className="mt-2 text-red-600 font-mono text-xs bg-red-50/80 backdrop-blur-sm border border-red-200/50 px-3 py-2 rounded-lg shadow-sm">
                   <span className="font-semibold">Error:</span> {tool.error}
                </div>
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
    </GlassCard>
  )
}
