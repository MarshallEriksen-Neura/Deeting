import { Plus, Terminal } from "lucide-react"
import { GlassButton } from "@/components/ui/glass-button"
import dynamic from "next/dynamic"

const AddServerSheet = dynamic(() => import("./add-server-sheet").then(mod => mod.AddServerSheet), { ssr: false })

export function RegistryHeader() {
  return (
    <div className="flex items-end justify-between">
      <div className="space-y-1">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-[var(--foreground)]">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] shadow-sm">
            <Terminal size={22} />
          </div>
          MCP Registry
        </h1>
        <p className="max-w-2xl text-sm text-[var(--muted)]">
          Manage Model Context Protocol services and upstream sync sources with Deeting OS runtime.
        </p>
      </div>

      <AddServerSheet>
        <GlassButton variant="default" size="lg" className="px-6">
          <Plus size={18} className="mr-2" />
          Add Manual Server
        </GlassButton>
      </AddServerSheet>
    </div>
  )
}

