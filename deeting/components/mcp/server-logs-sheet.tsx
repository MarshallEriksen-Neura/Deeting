"use client"

import { useMemo, useRef, useState, useEffect } from "react"
import { Terminal, Copy, Download, Trash2, PauseCircle, PlayCircle, Activity } from "lucide-react"
import { useTranslations } from "next-intl"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/shadcn/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/shadcn/tabs"
import { Button } from "@/components/ui/shadcn/button"
import { ScrollArea } from "@/components/ui/shadcn/scroll-area"
import { Badge } from "@/components/ui/shadcn/badge"
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
            <SheetContent side="bottom" className="h-[60vh] flex flex-col p-0 gap-0 bg-[var(--panel-bg)] text-[var(--ink)]">
                <div className="flex items-center justify-between border-b border-[var(--hairline)] bg-[var(--panel-bg)] p-4">
                     <div>
                        <SheetTitle className="flex items-center gap-2 font-mono text-sm">
                            <Terminal size={16} className="text-[var(--ink-3)]" />
                            {tool.name}
                            <Badge variant="outline" className="border-[var(--hairline)] bg-[var(--panel-bg-inset)] text-xs font-normal text-[var(--ink-2)]">{t("tool.labels.id")}: {tool.identifier || tool.id}</Badge>
                        </SheetTitle>
                        <SheetDescription className="hidden">{t("logs.title")}</SheetDescription>
                     </div>
                     <div className="flex items-center gap-2">
                         <Button 
                            variant="ghost" 
                            size="sm" 
                            className={cn("h-7 gap-1.5 px-2 text-xs", autoScroll ? "bg-[var(--ok-soft)] text-[var(--ok)]" : "text-[var(--ink-3)]")}
                            onClick={() => setAutoScroll(!autoScroll)}
                         >
                             {autoScroll ? <PlayCircle size={12} /> : <PauseCircle size={12} />}
                             {t("logs.autoScroll")}
                         </Button>
                         <div className="mx-1 h-4 w-px bg-[var(--hairline)]" />
                         <Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--ink-3)] hover:text-[var(--ink)]" onClick={handleCopy}>
                             <Copy size={14} />
                         </Button>
                         <Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--ink-3)] hover:text-[var(--ink)]" onClick={handleDownload}>
                             <Download size={14} />
                         </Button>
                         <Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--ink-3)] hover:text-[var(--danger)]" onClick={() => {
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
                    <div className="border-b border-[var(--hairline)] bg-[var(--panel-bg-inset)] px-4">
                        <TabsList className="h-9 gap-4 bg-transparent p-0">
                            <TabsTrigger 
                                value="stdout" 
                                className="h-9 rounded-none border-b-2 border-transparent px-1 font-mono text-xs text-[var(--ink-3)] data-[state=active]:border-[var(--ink)] data-[state=active]:text-[var(--ink)] data-[state=active]:shadow-none"
                            >
                                {t("logs.tabs.stdout")}
                            </TabsTrigger>
                            <TabsTrigger 
                                value="stderr" 
                                className="h-9 rounded-none border-b-2 border-transparent px-1 font-mono text-xs text-[var(--ink-3)] data-[state=active]:border-[var(--danger)] data-[state=active]:text-[var(--danger)] data-[state=active]:shadow-none"
                            >
                                {t("logs.tabs.stderr")}
                            </TabsTrigger>
                            <TabsTrigger 
                                value="events" 
                                className="h-9 rounded-none border-b-2 border-transparent px-1 font-mono text-xs text-[var(--ink-3)] data-[state=active]:border-[var(--info)] data-[state=active]:text-[var(--info)] data-[state=active]:shadow-none"
                            >
                                {t("logs.tabs.events")}
                            </TabsTrigger>
                        </TabsList>
                    </div>
                    
                    <div className="group relative flex-1 overflow-hidden bg-black font-mono text-xs text-zinc-300">
                        <TabsContent value="stdout" className="h-full m-0 p-0">
                             <ScrollArea className="h-full w-full p-4">
                                {stdoutLogs.length === 0 ? (
                                  <div className="p-4 text-center italic text-zinc-500">{t("logs.empty")}</div>
                                ) : (
                                  <div className="whitespace-pre-wrap">
                                    {stdoutLogs.map((entry, index) => (
                                      <div key={`${entry.timestamp}-${index}`}>
                                        <span className="select-none text-zinc-500">{formatTimestamp(entry.timestamp)}</span>{" "}
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
                                            <span className="select-none text-zinc-500">{formatTimestamp(entry.timestamp)}</span>{" "}
                                            {entry.message}
                                          </div>
                                        ))}
                                        <div ref={bottomRef} />
                                     </div>
                                 ) : (
                                     <div className="p-4 text-center italic text-zinc-500">{t("logs.emptyErrors")}</div>
                                 )}
                             </ScrollArea>
                        </TabsContent>
                        <TabsContent value="events" className="h-full m-0 p-0">
                             <ScrollArea className="h-full w-full p-4">
                                <div className="flex flex-col gap-2">
                                    {eventLogs.length === 0 ? (
                                      <div className="p-4 text-center italic text-zinc-500">{t("logs.empty")}</div>
                                    ) : (
                                      eventLogs.map((entry, index) => (
                                        <div key={`${entry.timestamp}-${index}`} className="flex gap-3 items-start">
                                          <Activity size={14} className="mt-0.5 text-[var(--info)]" />
                                          <div>
                                            <span className="font-bold text-[var(--info)]">{entry.message}</span>
                                            <span className="block text-[10px] text-zinc-600">{formatTimestamp(entry.timestamp)}</span>
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
