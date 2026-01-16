"use client"

import { useMemo, useRef, useState, useEffect } from "react"
import { Terminal, Copy, Download, Trash2, PauseCircle, PlayCircle, Activity } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { MCPLogEntry, MCPTool } from "@/types/mcp"
import { cn } from "@/lib/utils"
import { useNotifications } from "@/components/contexts/notification-context"

interface ServerLogsSheetProps {
    tool: MCPTool | null
    logs: MCPLogEntry[]
    open: boolean
    onOpenChange: (open: boolean) => void
    onClear: () => void
}

const formatTimestamp = (value: string) => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return value
  return parsed.toLocaleTimeString()
}

export function ServerLogsSheet({ tool, logs, open, onOpenChange, onClear }: ServerLogsSheetProps) {
    const t = useTranslations("mcp")
    const { addNotification } = useNotifications()
    const [autoScroll, setAutoScroll] = useState(true)
    const bottomRef = useRef<HTMLDivElement | null>(null)
    const { stdoutLogs, stderrLogs, eventLogs } = useMemo(() => {
      return {
        stdoutLogs: logs.filter((entry) => entry.stream === "stdout"),
        stderrLogs: logs.filter((entry) => entry.stream === "stderr"),
        eventLogs: logs.filter((entry) => entry.stream === "event"),
      }
    }, [logs])

    useEffect(() => {
      if (!autoScroll) return
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [autoScroll, logs])

    const handleCopy = async () => {
      try {
        const text = logs
          .map((entry) => `${formatTimestamp(entry.timestamp)} [${entry.stream}] ${entry.message}`)
          .join("\n")
        await navigator.clipboard.writeText(text)
        addNotification({
          type: "success",
          title: t("logs.copied"),
          description: "",
          timestamp: Date.now(),
        })
      } catch (err) {
        addNotification({
          type: "error",
          title: t("toast.saveFailed"),
          description: String(err),
          timestamp: Date.now(),
        })
      }
    }

    const handleDownload = () => {
      const text = logs
        .map((entry) => `${formatTimestamp(entry.timestamp)} [${entry.stream}] ${entry.message}`)
        .join("\n")
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `${tool?.name || "mcp"}-logs.txt`
      link.click()
      URL.revokeObjectURL(url)
      addNotification({
        type: "success",
        title: t("logs.downloaded"),
        description: "",
        timestamp: Date.now(),
      })
    }
    
    if (!tool) return null

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="bottom" className="h-[60vh] flex flex-col p-0 gap-0">
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white">
                     <div>
                        <SheetTitle className="flex items-center gap-2 font-mono text-sm">
                            <Terminal size={16} className="text-gray-500" /> 
                            {tool.name}
                            <Badge variant="outline" className="text-xs font-normal text-gray-500">{t("tool.labels.id")}: {tool.identifier || tool.id}</Badge>
                        </SheetTitle>
                        <SheetDescription className="hidden">{t("logs.title")}</SheetDescription>
                     </div>
                     <div className="flex items-center gap-2">
                         <Button 
                            variant="ghost" 
                            size="sm" 
                            className={cn("h-7 px-2 text-xs gap-1.5", autoScroll ? "text-green-600 bg-green-50" : "text-gray-500")}
                            onClick={() => setAutoScroll(!autoScroll)}
                         >
                             {autoScroll ? <PlayCircle size={12} /> : <PauseCircle size={12} />}
                             {t("logs.autoScroll")}
                         </Button>
                         <div className="h-4 w-px bg-gray-200 mx-1" />
                         <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-gray-900" onClick={handleCopy}>
                             <Copy size={14} />
                         </Button>
                         <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-gray-900" onClick={handleDownload}>
                             <Download size={14} />
                         </Button>
                         <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-red-600" onClick={() => {
                           onClear()
                           addNotification({
                             type: "success",
                             title: t("logs.cleared"),
                             description: "",
                             timestamp: Date.now(),
                           })
                         }}>
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
                                {t("logs.tabs.stdout")}
                            </TabsTrigger>
                            <TabsTrigger 
                                value="stderr" 
                                className="h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-red-500 data-[state=active]:text-red-600 data-[state=active]:shadow-none px-1 font-mono text-xs"
                            >
                                {t("logs.tabs.stderr")}
                            </TabsTrigger>
                            <TabsTrigger 
                                value="events" 
                                className="h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:text-blue-600 data-[state=active]:shadow-none px-1 font-mono text-xs"
                            >
                                {t("logs.tabs.events")}
                            </TabsTrigger>
                        </TabsList>
                    </div>
                    
                    <div className="flex-1 bg-black text-gray-300 font-mono text-xs overflow-hidden relative group">
                        <TabsContent value="stdout" className="h-full m-0 p-0">
                             <ScrollArea className="h-full w-full p-4">
                                {stdoutLogs.length === 0 ? (
                                  <div className="text-gray-500 italic p-4 text-center">{t("logs.empty")}</div>
                                ) : (
                                  <div className="whitespace-pre-wrap">
                                    {stdoutLogs.map((entry, index) => (
                                      <div key={`${entry.timestamp}-${index}`}>
                                        <span className="text-gray-500 select-none">{formatTimestamp(entry.timestamp)}</span>{" "}
                                        {entry.message}
                                      </div>
                                    ))}
                                    <div ref={bottomRef} />
                                  </div>
                                )}
                             </ScrollArea>
                        </TabsContent>
                        <TabsContent value="stderr" className="h-full m-0 p-0">
                             <ScrollArea className="h-full w-full p-4">
                                 {stderrLogs.length > 0 ? (
                                     <div className="text-red-400 whitespace-pre-wrap">
                                        {stderrLogs.map((entry, index) => (
                                          <div key={`${entry.timestamp}-${index}`}>
                                            <span className="text-gray-500 select-none">{formatTimestamp(entry.timestamp)}</span>{" "}
                                            {entry.message}
                                          </div>
                                        ))}
                                        <div ref={bottomRef} />
                                     </div>
                                 ) : (
                                     <div className="text-gray-500 italic p-4 text-center">{t("logs.emptyErrors")}</div>
                                 )}
                             </ScrollArea>
                        </TabsContent>
                        <TabsContent value="events" className="h-full m-0 p-0">
                             <ScrollArea className="h-full w-full p-4">
                                <div className="flex flex-col gap-2">
                                    {eventLogs.length === 0 ? (
                                      <div className="text-gray-500 italic p-4 text-center">{t("logs.empty")}</div>
                                    ) : (
                                      eventLogs.map((entry, index) => (
                                        <div key={`${entry.timestamp}-${index}`} className="flex gap-3 items-start">
                                          <Activity size={14} className="mt-0.5 text-blue-500" />
                                          <div>
                                            <span className="text-blue-400 font-bold">{entry.message}</span>
                                            <span className="text-gray-600 text-[10px] block">{formatTimestamp(entry.timestamp)}</span>
                                          </div>
                                        </div>
                                      ))
                                    )}
                                    <div ref={bottomRef} />
                                </div>
                             </ScrollArea>
                        </TabsContent>
                    </div>
                </Tabs>
            </SheetContent>
        </Sheet>
    )
}
