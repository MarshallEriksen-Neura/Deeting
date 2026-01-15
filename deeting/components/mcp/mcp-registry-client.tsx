"use client"

import { useState } from "react"
import { Plus, Terminal, AlertTriangle, ShieldCheck, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ServerCard } from "./server-card"
import { SyncSourceCard } from "./sync-source-card"
import { AddServerSheet } from "./add-server-sheet"
import { AddSourceDialog } from "./add-source-dialog"
import { ServerLogsSheet } from "./server-logs-sheet"
import { ConflictResolutionDialog } from "./conflict-resolution-dialog"
import { MCPTool, MCPSource } from "@/types/mcp"

interface MCPRegistryClientProps {
  initialTools: MCPTool[]
  initialSources: MCPSource[]
}

export function MCPRegistryClient({ initialTools, initialSources }: MCPRegistryClientProps) {
  // Add a mock conflict for demonstration if not present
  const [tools, setTools] = useState<MCPTool[]>(() => {
     const hasConflict = initialTools.some(t => t.conflict);
     if (!hasConflict && initialTools.length > 0) {
         // Inject a mock conflict into the first synced tool or first tool
         const targetIndex = initialTools.findIndex(t => t.source !== 'local') || 0;
         if (targetIndex !== -1) {
             const newTools = [...initialTools];
             newTools[targetIndex] = {
                 ...newTools[targetIndex],
                 conflict: {
                     currentArgs: ["--readonly", "--port", "3000"],
                     incomingArgs: ["--write-allowed", "--port", "3000", "--debug"],
                     warning: "Incoming configuration enables write access which was previously restricted."
                 }
             }
             return newTools;
         }
     }
     return initialTools;
  })

  // Add trust levels to sources if missing (mock)
  const [sources, setSources] = useState<MCPSource[]>(() => initialSources.map(s => ({
      ...s,
      trustLevel: s.type === 'local' ? 'private' : s.type === 'modelscope' ? 'official' : 'community'
  })))

  const [activeTab, setActiveTab] = useState("all")
  const [selectedTool, setSelectedTool] = useState<MCPTool | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  
  const [conflictTool, setConflictTool] = useState<MCPTool | null>(null)
  const [conflictOpen, setConflictOpen] = useState(false)

  const handleToggleTool = (id: string, enabled: boolean) => {
    setTools(prev => prev.map(t => {
      if (t.id === id) {
        return { 
           ...t, 
           status: enabled ? 'starting' : 'stopped',
           ping: enabled ? '...' : '-' 
        }
      }
      return t
    }))

    if (enabled) {
        setTimeout(() => {
            setTools(prev => prev.map(t => {
                if (t.id === id && t.status === 'starting') {
                    return { ...t, status: 'running', ping: '12ms' }
                }
                return t
            }))
        }, 1500)
    }
  }

  const handleSyncSource = (id: string) => {
     setSources(prev => prev.map(s => s.id === id ? { ...s, status: 'syncing' } : s))
     
     setTimeout(() => {
         setSources(prev => prev.map(s => s.id === id ? { ...s, status: 'active', lastSynced: 'Just now' } : s))
     }, 2000)
  }
  
  const handleShowLogs = (tool: MCPTool) => {
      setSelectedTool(tool)
      setLogsOpen(true)
  }

  const handleResolveConflict = (tool: MCPTool) => {
      setConflictTool(tool)
      setConflictOpen(true)
  }

  const onConflictResolved = (action: 'keep' | 'update') => {
      if (!conflictTool) return;
      
      setTools(prev => prev.map(t => {
          if (t.id === conflictTool.id) {
              const updated = { ...t, conflict: undefined };
              // Logic to update args would go here
              return updated;
          }
          return t;
      }))
      setConflictOpen(false)
  }

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
    <div className="p-8 min-h-screen bg-white space-y-12 max-w-7xl mx-auto">
      
      {/* Page Header */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-900">
            <Terminal className="text-purple-600" /> MCP Registry
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage Model Context Protocol services and upstream sync sources.
          </p>
        </div>
        
        <AddServerSheet>
            <Button className="bg-black text-white hover:bg-gray-800 shadow-sm">
               <Plus size={16} className="mr-2"/> Add Manual Server
            </Button>
        </AddServerSheet>
      </div>

      {/* SECTION 1: The Supply Chain */}
      <section className="space-y-4">
         <div className="flex items-center gap-2 mb-2">
             <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">The Supply Chain</h2>
             <div className="h-px bg-gray-100 flex-1" />
             <AddSourceDialog>
                <Button variant="ghost" size="sm" className="text-xs text-gray-500 hover:text-gray-900">
                   + Add Source
                </Button>
             </AddSourceDialog>
         </div>

         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {sources.map(source => (
                <SyncSourceCard 
                    key={source.id} 
                    source={source} 
                    onSync={handleSyncSource}
                />
            ))}
         </div>
      </section>

      {/* Separator */}
      {/* <Separator /> */}

      {/* SECTION 2: The Runtime Grid */}
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
                    onToggle={handleToggleTool}
                    onClick={() => handleShowLogs(tool)}
                    onResolveConflict={() => handleResolveConflict(tool)}
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
      
      {/* Logs Drawer */}
      <ServerLogsSheet 
          tool={selectedTool} 
          open={logsOpen} 
          onOpenChange={setLogsOpen} 
      />

      {/* Conflict Dialog */}
      <ConflictResolutionDialog 
         tool={conflictTool}
         open={conflictOpen}
         onOpenChange={setConflictOpen}
         onResolve={onConflictResolved}
      />

    </div>
  )
}
