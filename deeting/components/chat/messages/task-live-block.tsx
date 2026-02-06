"use client"

import { useEffect, useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Check, Loader2, Terminal, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { setTaskProgressCallback } from "@/components/notifications/use-notification-realtime"

interface TaskLog {
  timestamp: string
  message: string
  level: "info" | "warn" | "error" | "success"
}

interface TaskState {
  taskId: string
  status: "processing" | "completed" | "failed"
  step: string
  message: string
  percentage?: number
  logs: TaskLog[]
  startTime: number
  endTime?: number
}

interface TaskLiveBlockProps {
  taskId: string
  initialStatus?: string
  className?: string
}

export function TaskLiveBlock({ taskId, initialStatus = "processing", className }: TaskLiveBlockProps) {
  const [task, setTask] = useState<TaskState>({
    taskId,
    status: initialStatus as any,
    step: "initializing",
    message: "Waiting for task updates...",
    percentage: 0,
    logs: [],
    startTime: Date.now(),
  })
  
  const [isExpanded, setIsExpanded] = useState(true)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when logs update
  useEffect(() => {
    if (isExpanded && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [task.logs, isExpanded])

  // Register global listener
  useEffect(() => {
    setTaskProgressCallback((payload: any) => {
      // Filter for this specific task
      if (payload.task_id !== taskId) return

      setTask(prev => {
        const newLog: TaskLog = {
          timestamp: new Date().toLocaleTimeString(),
          message: payload.message,
          level: payload.status === "failed" ? "error" : payload.status === "completed" ? "success" : "info"
        }
        
        // Don't add duplicate logs if message is same as last one
        const logs = [...prev.logs]
        if (logs.length === 0 || logs[logs.length - 1].message !== payload.message) {
          logs.push(newLog)
        }

        return {
          ...prev,
          status: payload.status,
          step: payload.step,
          message: payload.message,
          percentage: payload.percentage ?? prev.percentage,
          logs,
          endTime: payload.status !== "processing" ? Date.now() : undefined
        }
      })
    })

    return () => {
      // Cleanup: we might want to allow multiple listeners in future, 
      // but for now simple replacement is fine as usually only one live block is active at bottom
      setTaskProgressCallback(() => {}) 
    }
  }, [taskId])

  const duration = ((task.endTime || Date.now()) - task.startTime) / 1000

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "w-full max-w-2xl overflow-hidden rounded-md border bg-card text-card-foreground shadow-sm",
        task.status === "completed" && "border-green-500/30 bg-green-500/5",
        task.status === "failed" && "border-red-500/30 bg-red-500/5",
        className
      )}
    >
      {/* Header */}
      <div 
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <StatusIcon status={task.status} />
          <div className="flex flex-col">
            <span className="text-sm font-medium flex items-center gap-2">
              {task.status === "processing" ? "Executing System Task" : 
               task.status === "completed" ? "Task Completed" : "Task Failed"}
               <span className="text-xs text-muted-foreground font-normal">
                 {duration.toFixed(1)}s
               </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {task.message}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {task.status === "processing" && (
            <span className="text-xs font-mono text-muted-foreground">
              {task.percentage}%
            </span>
          )}
          {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      {/* Progress Bar */}
      {task.status === "processing" && (
        <div className="h-1 w-full bg-muted overflow-hidden">
          <motion.div 
            className="h-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${task.percentage}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      )}

      {/* Terminal / Logs Area */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="border-t bg-black/90 p-4 font-mono text-xs">
              <ScrollArea className="h-[150px] w-full pr-4">
                <div className="flex flex-col gap-1.5">
                  {task.logs.length === 0 && (
                    <span className="text-muted-foreground italic">Waiting for logs...</span>
                  )}
                  {task.logs.map((log, i) => (
                    <div key={i} className="flex gap-2 text-zinc-300">
                      <span className="text-zinc-500 select-none">[{log.timestamp}]</span>
                      <span className={cn(
                        log.level === "error" && "text-red-400",
                        log.level === "success" && "text-green-400",
                        log.level === "warn" && "text-yellow-400",
                      )}>
                        {log.level === "info" && "> "}
                        {log.message}
                      </span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              </ScrollArea>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function StatusIcon({ status }: { status: TaskState["status"] }) {
  if (status === "processing") {
    return (
      <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/20 opacity-75 duration-1000" />
      </div>
    )
  }
  if (status === "completed") {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/10 text-green-500">
        <Check className="h-4 w-4" />
      </div>
    )
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10 text-red-500">
      <AlertTriangle className="h-4 w-4" />
    </div>
  )
}
