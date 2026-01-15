"use client"

import { RefreshCw, Server, Globe, Folder, ShieldCheck, Lock, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { MCPSource } from "@/types/mcp"

interface SyncSourceCardProps {
  source: MCPSource
  onSync?: (id: string) => void
}

export function SyncSourceCard({ source, onSync }: SyncSourceCardProps) {
  const isModelScope = source.type === 'modelscope'
  const isLocal = source.type === 'local'

  const TrustBadge = () => {
      switch(source.trustLevel) {
          case 'official':
              return <Badge variant="secondary" className="h-5 px-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-100 gap-1"><ShieldCheck size={10} /> Official</Badge>
          case 'community':
              return <Badge variant="secondary" className="h-5 px-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-100 gap-1"><AlertTriangle size={10} /> Community</Badge>
          case 'private':
              return <Badge variant="secondary" className="h-5 px-1.5 bg-gray-100 text-gray-600 hover:bg-gray-200 border-gray-200 gap-1"><Lock size={10} /> Private</Badge>
          default:
              return null
      }
  }

  return (
    <Card className={cn(
      "p-4 flex flex-col gap-3 shadow-sm transition-all hover:shadow-md border",
      // Ceramic/Ink style: Clean borders, subtle backgrounds
      isModelScope ? "bg-white border-purple-100" : "bg-white border-gray-200"
    )}>
       <div className="flex justify-between items-start">
           <div className="flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center border shadow-sm",
                isModelScope ? "bg-purple-50/50 border-purple-100 text-purple-600" : "bg-gray-50 border-gray-100 text-gray-600"
              )}>
                 {isModelScope ? "MS" : isLocal ? <Server size={18} /> : <Folder size={18}/>}
              </div>
              <div>
                 <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-2">
                    {source.name}
                 </h3>
                 <p className="text-[10px] text-gray-400 font-mono mt-0.5 max-w-[150px] truncate" title={source.pathOrUrl}>
                    {source.pathOrUrl}
                 </p>
              </div>
           </div>
           
           <TrustBadge />
       </div>

       <div className="flex justify-between items-center pt-2 border-t border-gray-50">
           <div className="text-xs text-gray-400 flex items-center gap-1.5">
               {isModelScope ? (
                    <>
                        <Globe size={12} /> 
                        <span className={cn(source.status === 'syncing' && "animate-pulse")}>
                            {source.status === 'syncing' ? "Syncing..." : source.lastSynced || "Auto-Sync On"}
                        </span>
                    </>
               ) : (
                    <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-green-500" /> Active Local</span>
               )}
           </div>

           {source.type !== 'local' && (
               <Button 
                 size="icon" 
                 variant="ghost" 
                 className="h-7 w-7 text-gray-400 hover:text-gray-900"
                 onClick={() => onSync?.(source.id)}
                 disabled={source.status === 'syncing'}
               >
                  <RefreshCw size={14} className={cn(source.status === 'syncing' && "animate-spin")} />
               </Button>
           )}
       </div>
    </Card>
  )
}