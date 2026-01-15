import { useState } from "react"
import { Terminal } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { ServerCard } from "./server-card"
import { MCPTool } from "@/types/mcp"

interface RuntimeGridSectionProps {
  tools: MCPTool[]
  onToggleTool: (id: string, enabled: boolean) => void
  onShowLogs: (tool: MCPTool) => void
  onResolveConflict: (tool: MCPTool) => void
}

export function RuntimeGridSection({ 
  tools, 
  onToggleTool, 
  onShowLogs, 
  onResolveConflict 
}: RuntimeGridSectionProps) {
  const [activeTab, setActiveTab] = useState("all")

  const filteredTools = tools.filter(tool => {
      if (activeTab === 'all') return true
      if (activeTab === 'running') return tool.status === 'running' || tool.status === 'degraded' || tool.status === 'starting'
      if (activeTab === 'stopped') return tool.status === 'stopped' || tool.status === 'crashed'
      if (activeTab === 'conflicts') return !!tool.conflict
      return true
  })

  const runningCount = tools.filter(t => t.status === 'running' || t.status === 'degraded' || t.status === 'starting').length
  const conflictCount = tools.filter(t => !!t.conflict).length

  return (
    <section className="space-y-4">
       <div className="flex items-center justify-between mb-4">
           <div className="flex items-center gap-2 w-full">
               <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider whitespace-nowrap">The Runtime Grid</h2>
               <div className="h-px bg-gray-100 flex-1 mx-4" />
           </div>
       </div>

       <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex justify-between items-center mb-6">
             <TabsList className="bg-gray-100/50 p-1 border border-gray-200">
                <TabsTrigger value="all" className="text-xs">All Servers</TabsTrigger>
                <TabsTrigger value="running" className="text-xs">
                    Running 
                    {runningCount > 0 && <span className="ml-1.5 bg-green-100 text-green-700 px-1 rounded-full text-[10px] min-w-[16px] text-center">{runningCount}</span>}
                </TabsTrigger>
                <TabsTrigger value="stopped" className="text-xs">Stopped</TabsTrigger>
                <TabsTrigger value="conflicts" className="text-xs data-[state=active]:text-amber-700">
                    Conflicts
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
              />
          ))}
          
          {filteredTools.length === 0 && (
              <div className="col-span-full py-16 flex flex-col items-center justify-center text-gray-400 border border-dashed border-gray-200 rounded-xl bg-gray-50/30">
                  <Terminal size={32} className="mb-3 opacity-20" />
                  <p className="text-sm">No servers found for this filter.</p>
              </div>
          )}
       </div>
    </section>
  )
}
