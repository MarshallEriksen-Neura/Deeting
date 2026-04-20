"use client"

import { useMemo } from "react"
import { MarkdownViewer } from "@/components/chat/markdown-viewer"
import { ViewCard } from "./view-card"

interface FallbackJsonViewProps {
  data: unknown
  viewType: string
  title?: string
}

export function FallbackJsonView({ data, viewType, title }: FallbackJsonViewProps) {
  const content = useMemo(() => {
    try {
      return `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
    } catch {
      return String(data)
    }
  }, [data])

  return (
    <ViewCard title={title} viewType={viewType}>
      <div className="overflow-x-auto">
        <MarkdownViewer
          content={content}
          className="chat-markdown chat-markdown-assistant text-xs"
        />
      </div>
    </ViewCard>
  )
}
