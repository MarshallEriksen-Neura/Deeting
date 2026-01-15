"use client"

import { Terminal } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { MCPTool } from "@/types/mcp"

interface ServerLogsSheetProps {
    tool: MCPTool | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function ServerLogsSheet({ tool, open, onOpenChange }: ServerLogsSheetProps) {
    if (!tool) return null

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="bottom" className="h-[50vh]">
                <SheetHeader>
                    <SheetTitle className="flex items-center gap-2 font-mono">
                        <Terminal size={16} /> 
                        {tool.name} Logs
                    </SheetTitle>
                    <SheetDescription>
                        Real-time stderr/stdout output from the MCP process.
                    </SheetDescription>
                </SheetHeader>
                
                <div className="mt-4 h-full bg-black text-green-400 p-4 rounded-md font-mono text-xs overflow-y-auto whitespace-pre-wrap pb-20">
                    {`> Starting ${tool.name}...
> Command: ${tool.command || 'npx'} ${(tool.args || []).join(' ')}
[INFO] Server listening on stdio
[INFO] Capabilities exchanged
${tool.status === 'error' ? `[ERROR] Connection refused
[ERROR] Process exited with code 1` : `[INFO] Heartbeat received (ping: ${tool.ping})
[DEBUG] Processing request: list_tools
[DEBUG] Processing request: list_resources`}
...`}
                </div>
            </SheetContent>
        </Sheet>
    )
}
