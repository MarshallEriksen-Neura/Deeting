"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { RegistryHeader } from "./registry-header"
import { SupplyChainSection } from "./supply-chain-section"
import { RuntimeGridSection } from "./runtime-grid-section"
import { MCPTool, MCPSource } from "@/types/mcp"

const ServerLogsSheet = dynamic(() => import("./server-logs-sheet").then(mod => mod.ServerLogsSheet), { ssr: false })
const ConflictResolutionDialog = dynamic(() => import("./conflict-resolution-dialog").then(mod => mod.ConflictResolutionDialog), { ssr: false })

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

  const onConflictResolved = () => {
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

  return (
    <div className="relative min-h-screen bg-[var(--background)] px-6 py-12 lg:px-8">
      {/* Background decorative elements */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-[10%] -left-[10%] h-[40%] w-[40%] rounded-full bg-[var(--primary)]/5 blur-[120px]" />
        <div className="absolute top-[20%] -right-[5%] h-[35%] w-[35%] rounded-full bg-[var(--teal-accent)]/5 blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl space-y-16">
        <div className="animate-glass-card-in stagger-1">
          <RegistryHeader />
        </div>

        <div className="animate-glass-card-in stagger-2">
          <SupplyChainSection sources={sources} onSync={handleSyncSource} />
        </div>

        <div className="animate-glass-card-in stagger-3">
          <RuntimeGridSection
            tools={tools}
            onToggleTool={handleToggleTool}
            onShowLogs={handleShowLogs}
            onResolveConflict={handleResolveConflict}
          />
        </div>
      </div>

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

