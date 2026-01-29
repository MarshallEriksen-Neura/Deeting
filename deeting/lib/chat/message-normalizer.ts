import type { MessageBlock } from '@/lib/chat/message-protocol'

const THINK_REGEX = /<think>([\s\S]*?)<\/think>/g
const TOOL_CODE_REGEX = /<tool_code(?:\s+name="([^"]*)")?(?:\s+status="([^"]*)")?>([\s\S]*?)<\/tool_code>/g

export function normalizeMessage(
  content: string,
  toolOutputs?: Array<{ call_id: string; result: unknown }>
): MessageBlock[] {
  const blocks: MessageBlock[] = []
  
  // Combine regex matching to preserve order
  // We'll use a simple tokenization approach
  const regex = new RegExp(`${THINK_REGEX.source}|${TOOL_CODE_REGEX.source}`, 'g')
  
  let lastIndex = 0
  let match: RegExpExecArray | null
  let blockIndex = 0

  while ((match = regex.exec(content)) !== null) {
    // Handle plain text before the match
    if (match.index > lastIndex) {
      const text = content.substring(lastIndex, match.index)
      if (text.trim()) {
        blocks.push({
          id: `text-${++blockIndex}`,
          type: 'text',
          content: text,
          streamState: 'completed',
          displayMode: 'bubble',
        })
      }
    }

    // Determine which pattern matched
    const fullMatch = match[0]
    
    if (fullMatch.startsWith('<think>')) {
      // <think> capture is group 1 (based on source concatenation, it might shift)
      // THINK_REGEX has 1 capturing group.
      // TOOL_CODE_REGEX has 3 capturing groups.
      // In `regex`, the groups are:
      // 1: think content
      // 2: tool name
      // 3: tool status
      // 4: tool args
      const thinkContent = match[1]
      blocks.push({
        id: `thought-${++blockIndex}`,
        type: 'thought',
        content: thinkContent?.trim() || "",
        streamState: 'completed',
        displayMode: 'bubble',
      })
    } else if (fullMatch.startsWith('<tool_code')) {
      const toolName = match[2] || "unknown"
      const toolStatus = match[3] || "running"
      const toolArgs = match[4] || ""
      
      blocks.push({
        id: `tool-${++blockIndex}`,
        type: 'tool_call',
        toolName: toolName,
        toolArgs: toolArgs.trim(),
        status: toolStatus as 'running' | 'success' | 'error',
        streamState: 'completed',
        displayMode: 'bubble',
      })
    }

    lastIndex = regex.lastIndex
  }

  if (lastIndex < content.length) {
    const text = content.substring(lastIndex)
    if (text.trim()) {
      blocks.push({
        id: `text-${++blockIndex}`,
        type: 'text',
        content: text,
        streamState: 'completed',
        displayMode: 'bubble',
      })
    }
  }

  if (blocks.length === 0 && content) {
    return [
      {
        id: 'text-1',
        type: 'text',
        content,
        streamState: 'completed',
        displayMode: 'bubble',
      },
    ]
  }

  if (toolOutputs?.length) {
    // Placeholder for future tool output normalization.
    void toolOutputs
  }

  return blocks
}
