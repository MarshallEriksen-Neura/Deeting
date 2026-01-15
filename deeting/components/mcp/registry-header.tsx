import { Plus, Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import dynamic from "next/dynamic"

const AddServerSheet = dynamic(() => import("./add-server-sheet").then(mod => mod.AddServerSheet), { ssr: false })

export function RegistryHeader() {
  return (
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
  )
}
