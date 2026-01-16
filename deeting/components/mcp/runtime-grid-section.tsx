"use client"

import { useState } from "react"
import { Terminal } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { ServerCard } from "./server-card"
import { MCPTool } from "@/types/mcp"
import { useTranslations } from "next-intl"

interface RuntimeGridSectionProps {
  tools: MCPTool[]
  conflictCount: number
  onToggleTool: (tool: MCPTool, enabled: boolean) => void
  onShowLogs: (tool: MCPTool) => void
  onResolveConflict: (tool: MCPTool) => void
  onConfigure: (tool: MCPTool) => void
}

export function RuntimeGridSection({ 
  tools, 
  conflictCount,
  onToggleTool, 
  onShowLogs, 
  onResolveConflict,
  onConfigure,
}: RuntimeGridSectionProps) {
  const t = useTranslations("mcp")
  const [activeTab, setActiveTab] = useState("all")

  const filteredTools = tools.filter(tool => {
      if (activeTab === 'all') return true
      if (activeTab === 'running') return tool.status === 'healthy' || tool.status === 'degraded' || tool.status === 'starting'
      if (activeTab === 'stopped') return tool.status === 'stopped' || tool.status === 'crashed' || tool.status === 'error' || tool.status === 'pending' || tool.status === 'orphaned'
      if (activeTab === 'conflicts') return tool.conflictStatus !== 'none'
      return true
  })

  const runningCount = tools.filter(t => t.status === 'healthy' || t.status === 'degraded' || t.status === 'starting').length

  return (
    <section className="space-y-4">
       <div className="flex items-center justify-between mb-4">
           <div className="flex items-center gap-2 w-full">
               <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider whitespace-nowrap">{t("runtime.title")}</h2>
               <div className="h-px bg-gray-100 flex-1 mx-4" />
           </div>
       </div>

       <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex justify-between items-center mb-6">
             <TabsList className="bg-gray-100/50 p-1 border border-gray-200">
                <TabsTrigger value="all" className="text-xs">{t("runtime.tabs.all")}</TabsTrigger>
                <TabsTrigger value="running" className="text-xs">
                    {t("runtime.tabs.running")}
                    {runningCount > 0 && <span className="ml-1.5 bg-green-100 text-green-700 px-1 rounded-full text-[10px] min-w-[16px] text-center">{runningCount}</span>}
                </TabsTrigger>
                <TabsTrigger value="stopped" className="text-xs">{t("runtime.tabs.stopped")}</TabsTrigger>
                <TabsTrigger value="conflicts" className="text-xs data-[state=active]:text-amber-700">
                    {t("runtime.tabs.conflicts")}
                    {conflictCount > 0 && <Badge variant="secondary" className="ml-1.5 bg-amber-100 text-amber-700 px-1 text-[10px] h-4 hover:bg-amber-100">{conflictCount}</Badge>}
                </TabsTrigger>
             </TabsList>
          </div>
       </Tabs>

       <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredTools.map(tool => (
              <ServerCard 
                  key={tool.id} 
                  tool={tool} 
                  onToggle={onToggleTool}
                  onClick={() => onShowLogs(tool)}
                  onResolveConflict={() => onResolveConflict(tool)}
                  onConfigure={() => onConfigure(tool)}
              />
          ))}
          
          {filteredTools.length === 0 && (
              <div className="col-span-full py-16 flex flex-col items-center justify-center text-gray-400 border border-dashed border-gray-200 rounded-xl bg-gray-50/30">
                  <Terminal size={32} className="mb-3 opacity-20" />
                  <p className="text-sm">{t("runtime.empty")}</p>
              </div>
          )}
       </div>
    </section>
  )
}
