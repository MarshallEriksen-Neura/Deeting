"use client"

import { useState } from "react"
import { Plus, Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ServerCard } from "./server-card"
import { SyncSourceCard } from "./sync-source-card"
import { AddServerSheet } from "./add-server-sheet"
import { AddSourceDialog } from "./add-source-dialog"
import { ServerLogsSheet } from "./server-logs-sheet"
import { MCPTool, MCPSource } from "@/types/mcp"

interface MCPRegistryClientProps {
  initialTools: MCPTool[]
  initialSources: MCPSource[]
}

export function MCPRegistryClient({ initialTools, initialSources }: MCPRegistryClientProps) {
  const [activeTab, setActiveTab] = useState("all")
  const [tools, setTools] = useState<MCPTool[]>(initialTools)
  const [sources, setSources] = useState<MCPSource[]>(initialSources)
  
  const [selectedTool, setSelectedTool] = useState<MCPTool | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)

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

    // Simulate async status change
    if (enabled) {
        setTimeout(() => {
            setTools(prev => prev.map(t => {
                if (t.id === id && t.status === 'starting') {
                    return { ...t, status: 'running', ping: '12ms' }
                }
                return t
            }))
        }, 1000)
    }
  }

  const handleSyncSource = (id: string) => {
     setSources(prev => prev.map(s => s.id === id ? { ...s, status: 'syncing' } : s))
     
     // Simulate sync
     setTimeout(() => {
         setSources(prev => prev.map(s => s.id === id ? { ...s, status: 'active', lastSynced: 'Just now' } : s))
     }, 2000)
  }
  
  const handleShowLogs = (tool: MCPTool) => {
      setSelectedTool(tool)
      setLogsOpen(true)
  }

  const filteredTools = tools.filter(tool => {
      if (activeTab === 'all') return true
      if (activeTab === 'running') return tool.status === 'running'
      if (activeTab === 'synced') return tool.source !== 'local'
      return true
  })

  const runningCount = tools.filter(t => t.status === 'running').length

  return (
    <div className="p-8 min-h-screen bg-gray-50/50 space-y-8">
      
      {/* 1. Header & Sync Hub */}
      <div className="flex flex-col gap-6">
         <div className="flex justify-between items-end">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Terminal className="text-purple-600" /> MCP Registry
              </h1>
              <p className="text-gray-500 text-sm mt-1">
                Manage Model Context Protocol services and upstream sync sources.
              </p>
            </div>
            
            <AddServerSheet>
                <Button className="bg-black text-white hover:bg-gray-800">
                   <Plus size={16} className="mr-2"/> Add Manual Server
                </Button>
            </AddServerSheet>
         </div>

         {/* Sync Sources Cards */}
         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {sources.map(source => (
                <SyncSourceCard 
                    key={source.id} 
                    source={source} 
                    onSync={handleSyncSource}
                />
            ))}

            {/* Add New Source Placeholder */}
            <AddSourceDialog>
                <div className="border border-dashed border-gray-300 rounded-xl flex items-center justify-center text-gray-400 text-sm cursor-pointer hover:bg-gray-50 hover:border-gray-400 transition h-[74px]">
                   + Add Sync Source
                </div>
            </AddSourceDialog>
         </div>
      </div>

      {/* 2. Tools Filters */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex justify-between items-center mb-4">
           <TabsList>
              <TabsTrigger value="all">All Servers</TabsTrigger>
              <TabsTrigger value="running">Running</TabsTrigger>
              <TabsTrigger value="synced">Synced Only</TabsTrigger>
           </TabsList>
           
           <div className="text-xs text-gray-400 font-mono">
              Running Process: {runningCount}/{tools.length}
           </div>
        </div>
      </Tabs>

      {/* 3. The Server Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
         {filteredTools.map(tool => (
            <ServerCard 
                key={tool.id} 
                tool={tool} 
                onToggle={handleToggleTool}
                onClick={() => handleShowLogs(tool)}
            />
         ))}
         
         {filteredTools.length === 0 && (
             <div className="col-span-full py-10 text-center text-gray-400">
                 No servers found for this filter.
             </div>
         )}
      </div>
      
      <ServerLogsSheet 
          tool={selectedTool} 
          open={logsOpen} 
          onOpenChange={setLogsOpen} 
      />

    </div>
  )
}