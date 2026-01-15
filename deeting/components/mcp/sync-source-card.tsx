"use client"

import { RefreshCw, Server, Globe, Folder } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { MCPSource } from "@/types/mcp"

interface SyncSourceCardProps {
  source: MCPSource
  onSync?: (id: string) => void
}

export function SyncSourceCard({ source, onSync }: SyncSourceCardProps) {
  const isModelScope = source.type === 'modelscope'
  const isLocal = source.type === 'local'

  return (
    <Card className={cn(
      "p-4 flex items-center justify-between shadow-sm group relative overflow-hidden transition-all",
      isModelScope ? "bg-gradient-to-br from-purple-50 to-white border-purple-100" : "bg-white border-blue-100"
    )}>
       {isLocal && (
          <div className="absolute right-0 top-0 p-1 bg-blue-500 text-white text-[10px] rounded-bl shadow-sm z-10">
             Active
          </div>
       )}

       <div className="flex items-center gap-4 z-0">
          <div className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center font-bold text-lg",
            isModelScope ? "bg-purple-100 text-purple-600" : "bg-blue-50 text-blue-600"
          )}>
             {isModelScope ? "MS" : isLocal ? <Server size={20} /> : <Folder size={20}/>}
          </div>
          <div>
             <h3 className={cn("font-bold text-sm", isModelScope ? "text-purple-900" : "text-gray-900")}>
                {source.name}
             </h3>
             <p className={cn("text-xs flex items-center gap-1", isModelScope ? "text-purple-400" : "text-gray-400")}>
                {isModelScope ? (
                    <>
                        <Globe size={10} /> {source.lastSynced ? `Synced: ${source.lastSynced}` : "Auto-Sync On"}
                    </>
                ) : (
                    source.pathOrUrl
                )}
             </p>
          </div>
       </div>
       
       {source.type !== 'local' && (
           <Button 
             size="sm" 
             variant="ghost" 
             className={cn(
                "hover:bg-opacity-50",
                isModelScope ? "text-purple-600 hover:bg-purple-100 hover:text-purple-700" : "text-gray-400"
             )}
             onClick={() => onSync?.(source.id)}
             disabled={source.status === 'syncing'}
           >
              <RefreshCw size={14} className={cn(source.status === 'syncing' ? "animate-spin" : "group-hover:animate-spin")} />
           </Button>
       )}
    </Card>
  )
}
