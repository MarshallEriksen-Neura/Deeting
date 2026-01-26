"use client"

import * as React from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

export interface TerminalLogsProps {
  logs: string[]
  className?: string
  autoScroll?: boolean
}

export function TerminalLogs({ logs, className, autoScroll = true }: TerminalLogsProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  if (!logs.length) return null

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className={cn("overflow-hidden", className)}
    >
      <div 
        ref={scrollRef}
        className="mt-2 p-3 rounded-lg bg-black/50 border border-white/10 font-mono text-[10px] text-muted-foreground space-y-1 max-h-[200px] overflow-y-auto"
      >
        {logs.map((log, i) => (
          <div key={i} className={cn(
            "break-all whitespace-pre-wrap",
            log.includes("success") || log.includes("Success") ? "text-emerald-400" : 
            log.toLowerCase().includes("fail") || log.toLowerCase().includes("error") ? "text-red-400" : 
            log.startsWith(">") ? "text-blue-300" : ""
          )}>
            {log}
          </div>
        ))}
      </div>
    </motion.div>
  )
}
