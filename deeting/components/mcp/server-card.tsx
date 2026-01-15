"use client"

import { Terminal, Lock, Settings } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { MCPTool } from "@/types/mcp"

interface ServerCardProps {
  tool: MCPTool
  onToggle?: (id: string, enabled: boolean) => void
  onClick?: () => void
}

export function ServerCard({ tool, onToggle, onClick }: ServerCardProps) {
  const isSynced = tool.source !== 'local'
  const isError = tool.status === 'error'
  const isRunning = tool.status === 'running'

  return (
    <Card 
      onClick={onClick}
      className={`
       relative overflow-hidden transition-all duration-200 hover:shadow-md cursor-pointer
       ${isError ? 'border-red-200 bg-red-50/30' : 'border-gray-200 bg-white'}
    `}>
       {/* Status Bar */}
       <div className={`absolute left-0 top-0 bottom-0 w-1 ${isError ? 'bg-red-500' : isRunning ? 'bg-green-500' : 'bg-gray-300'}`} />

       <div className="p-5 flex flex-col gap-4">
          
          {/* Header */}
          <div className="flex justify-between items-start">
             <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${isSynced ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-600'}`}>
                   <Terminal size={18} />
                </div>
                <div>
                   <div className="flex items-center gap-2">
                      <h3 className="font-bold text-gray-900">{tool.name}</h3>
                      {/* Sync Badge */}
                      {isSynced && (
                         <Badge variant="secondary" className="text-[10px] h-5 bg-purple-100 text-purple-600 px-1.5 hover:bg-purple-200">
                            Synced
                         </Badge>
                      )}
                   </div>
                   <p className="text-xs text-gray-500 font-mono mt-0.5">ID: {tool.id}</p>
                </div>
             </div>
             
             {/* Actions */}
             <div className="flex items-center gap-2">
                <Switch 
                  checked={isRunning} 
                  onCheckedChange={(checked) => onToggle?.(tool.id, checked)}
                  disabled={isError} // Maybe allow toggling to retry? Let's keep it simple for now.
                />
                <Button size="icon" variant="ghost" className="h-8 w-8 text-gray-400">
                   {isSynced ? <Lock size={14} /> : <Settings size={14} />}
                </Button>
             </div>
          </div>

          {/* Description */}
          <div className="min-h-[3em]">
            <p className="text-sm text-gray-600 line-clamp-2">
              {tool.description}
            </p>
            {isError && tool.error && (
                <span className="block mt-1 text-red-500 font-mono text-xs bg-red-100 p-1 rounded">
                   Error: {tool.error}
                </span>
             )}
          </div>

          {/* Footer: Capabilities & Ping */}
          <div className="flex justify-between items-center pt-2 border-t border-gray-100/50">
             <div className="flex gap-1 flex-wrap">
                {tool.capabilities.map(cap => (
                   <span key={cap} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono border border-gray-200">
                      {cap}
                   </span>
                ))}
             </div>
             
             <div className="flex items-center gap-1.5 text-xs font-mono text-gray-400">
                {!isError && tool.status !== 'stopped' && (
                   <>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                      {tool.ping}
                   </>
                )}
                {tool.status === 'stopped' && <span>Stopped</span>}
             </div>
          </div>

       </div>
    </Card>
  )
}
