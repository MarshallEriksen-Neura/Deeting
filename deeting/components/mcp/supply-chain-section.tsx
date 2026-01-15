import { Button } from "@/components/ui/button"
import { SyncSourceCard } from "./sync-source-card"
import { MCPSource } from "@/types/mcp"
import dynamic from "next/dynamic"

const AddSourceDialog = dynamic(() => import("./add-source-dialog").then(mod => mod.AddSourceDialog), { ssr: false })

interface SupplyChainSectionProps {
  sources: MCPSource[]
  onSync: (id: string) => void
}

export function SupplyChainSection({ sources, onSync }: SupplyChainSectionProps) {
  return (
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
                  onSync={onSync}
              />
          ))}
       </div>
    </section>
  )
}
