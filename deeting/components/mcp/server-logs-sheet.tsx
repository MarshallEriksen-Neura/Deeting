"use client"

import { useState } from "react"
import { Terminal, Copy, Download, Trash2, PauseCircle, PlayCircle, Activity } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { MCPTool } from "@/types/mcp"
import { cn } from "@/lib/utils"

interface ServerLogsSheetProps {
    tool: MCPTool | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function ServerLogsSheet({ tool, open, onOpenChange }: ServerLogsSheetProps) {
    const [autoScroll, setAutoScroll] = useState(true)
    
    if (!tool) return null

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="bottom" className="h-[60vh] flex flex-col p-0 gap-0">
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white">
                     <div>
                        <SheetTitle className="flex items-center gap-2 font-mono text-sm">
                            <Terminal size={16} className="text-gray-500" /> 
                            {tool.name}
                            <Badge variant="outline" className="text-xs font-normal text-gray-500">ID: {tool.id}</Badge>
                        </SheetTitle>
                        <SheetDescription className="hidden">Log Viewer</SheetDescription>
                     </div>
                     <div className="flex items-center gap-2">
                         <Button 
                            variant="ghost" 
                            size="sm" 
                            className={cn("h-7 px-2 text-xs gap-1.5", autoScroll ? "text-green-600 bg-green-50" : "text-gray-500")}
                            onClick={() => setAutoScroll(!autoScroll)}
                         >
                             {autoScroll ? <PlayCircle size={12} /> : <PauseCircle size={12} />}
                             Auto-scroll
                         </Button>
                         <div className="h-4 w-px bg-gray-200 mx-1" />
                         <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-gray-900">
                             <Copy size={14} />
                         </Button>
                         <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-gray-900">
                             <Download size={14} />
                         </Button>
                         <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-red-600">
                             <Trash2 size={14} />
                         </Button>
                     </div>
                </div>

                <Tabs defaultValue="stdout" className="flex-1 flex flex-col min-h-0">
                    <div className="px-4 border-b border-gray-100 bg-gray-50/50">
                        <TabsList className="bg-transparent h-9 p-0 gap-4">
                            <TabsTrigger 
                                value="stdout" 
                                className="h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:shadow-none px-1 font-mono text-xs"
                            >
                                stdout
                            </TabsTrigger>
                            <TabsTrigger 
                                value="stderr" 
                                className="h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-red-500 data-[state=active]:text-red-600 data-[state=active]:shadow-none px-1 font-mono text-xs"
                            >
                                stderr
                            </TabsTrigger>
                            <TabsTrigger 
                                value="events" 
                                className="h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:text-blue-600 data-[state=active]:shadow-none px-1 font-mono text-xs"
                            >
                                Events
                            </TabsTrigger>
                        </TabsList>
                    </div>
                    
                    <div className="flex-1 bg-black text-gray-300 font-mono text-xs overflow-hidden relative group">
                        <TabsContent value="stdout" className="h-full m-0 p-0">
                             <ScrollArea className="h-full w-full p-4">
                                <div className="whitespace-pre-wrap">
                                    <span className="text-gray-500 select-none">12:30:01</span> [INFO] Server started on port 3000{'
'}
                                    <span className="text-gray-500 select-none">12:30:02</span> [INFO] Connected to stdio transport{'
'}
                                    <span className="text-gray-500 select-none">12:30:02</span> [INFO] Capabilities: read_file, list_dir{'
'}
                                    <span className="text-gray-500 select-none">12:30:05</span> <span className="text-green-400">[DEBUG] Incoming request: list_tools</span>{'
'}
                                    <span className="text-gray-500 select-none">12:30:05</span> <span className="text-green-400">[DEBUG] Sending response: 2 tools found</span>{'
'}
                                    <span className="text-gray-500 select-none">12:30:15</span> [INFO] Heartbeat received (ping: {tool.ping}){'
'}
                                    {/* Simulated log tail */}
                                </div>
                             </ScrollArea>
                        </TabsContent>
                        <TabsContent value="stderr" className="h-full m-0 p-0">
                             <ScrollArea className="h-full w-full p-4">
                                 {tool.status === 'crashed' || tool.error ? (
                                     <div className="text-red-400 whitespace-pre-wrap">
                                        <span className="text-gray-500 select-none">12:35:00</span> [FATAL] Process exited with code 1{'
'}
                                        <span className="text-gray-500 select-none">12:35:00</span> Error: {tool.error || "Unknown error occurred"}{'
'}
                                        at Server.handleRequest (server.js:120:5){'
'}
                                        at Transport.onMessage (transport.js:45:12)
                                     </div>
                                 ) : (
                                     <div className="text-gray-500 italic p-4 text-center">No errors captured.</div>
                                 )}
                             </ScrollArea>
                        </TabsContent>
                        <TabsContent value="events" className="h-full m-0 p-0">
                             <ScrollArea className="h-full w-full p-4">
                                <div className="flex flex-col gap-2">
                                    <div className="flex gap-3 items-start">
                                        <Activity size={14} className="mt-0.5 text-blue-500" />
                                        <div>
                                            <span className="text-blue-400 font-bold">Status Changed</span>
                                            <p className="text-gray-400">Changed from <span className="text-gray-300">starting</span> to <span className="text-gray-300">running</span></p>
                                            <span className="text-gray-600 text-[10px]">2 minutes ago</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-3 items-start">
                                        <Activity size={14} className="mt-0.5 text-gray-500" />
                                        <div>
                                            <span className="text-gray-300 font-bold">Process Spawned</span>
                                            <p className="text-gray-400">PID: 4521, Command: npx ...</p>
                                            <span className="text-gray-600 text-[10px]">2 minutes ago</span>
                                        </div>
                                    </div>
                                </div>
                             </ScrollArea>
                        </TabsContent>
                    </div>
                </Tabs>
            </SheetContent>
        </Sheet>
    )
}