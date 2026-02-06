import type { MessageBlock } from '@/lib/chat/message-protocol'

const THINK_REGEX = /<think>([\s\S]*?)<\/think>/g
const TOOL_CODE_REGEX = /<tool_code(?:\s+name="([^"]*)")?(?:\s+status="([^"]*)")?>([\s\S]*?)<\/tool_code>/g

export function normalizeMessage(
  content: string,
  toolOutputs?: Array<{ call_id: string; result: unknown }>
): MessageBlock[] {
  const blocks: MessageBlock[] = []
  
  // 1. 定义正则表达式
  const regex = new RegExp(`${THINK_REGEX.source}|${TOOL_CODE_REGEX.source}`, 'g')
  let lastIndex = 0
  let match: RegExpExecArray | null
  let blockIndex = 0

  // 2. 匹配已闭合的标签
  while ((match = regex.exec(content)) !== null) {
    // 提取标签前的文本
    if (match.index > lastIndex) {
      const text = content.substring(lastIndex, match.index)
      if (text) {
        blocks.push({
          id: `text-${++blockIndex}`,
          type: 'text',
          content: text,
          streamState: 'completed',
          displayMode: 'bubble',
        })
      }
    }

    const fullMatch = match[0]
    if (fullMatch.startsWith('<think>')) {
      blocks.push({
        id: `thought-${++blockIndex}`,
        type: 'thought',
        content: (match[1] || "").trim(),
        streamState: 'completed',
        displayMode: 'bubble',
      })
    } else if (fullMatch.startsWith('<tool_code')) {
      blocks.push({
        id: `tool-${++blockIndex}`,
        type: 'tool_call',
        toolName: match[2] || "unknown",
        toolArgs: (match[4] || "").trim(),
        status: (match[3] || "running") as 'running' | 'success' | 'error',
        streamState: 'completed',
        displayMode: 'bubble',
      })
    }
    lastIndex = regex.lastIndex
  }

  // 3. 处理最后剩余的内容（可能包含未闭合标签）
  if (lastIndex < content.length) {
    const remaining = content.substring(lastIndex)
    
    const unfinishedThink = remaining.indexOf('<think>')
    const unfinishedTool = remaining.indexOf('<tool_code')
    
    if (unfinishedThink !== -1 && (unfinishedTool === -1 || unfinishedThink < unfinishedTool)) {
      if (unfinishedThink > 0) {
        blocks.push({
          id: `text-${++blockIndex}`,
          type: 'text',
          content: remaining.substring(0, unfinishedThink),
          streamState: 'completed',
          displayMode: 'bubble',
        })
      }
      blocks.push({
        id: `thought-${++blockIndex}`,
        type: 'thought',
        content: remaining.substring(unfinishedThink + 7),
        streamState: 'streaming',
        displayMode: 'bubble',
      })
    } else if (unfinishedTool !== -1) {
      if (unfinishedTool > 0) {
        blocks.push({
          id: `text-${++blockIndex}`,
          type: 'text',
          content: remaining.substring(0, unfinishedTool),
          streamState: 'completed',
          displayMode: 'bubble',
        })
      }
      const tagFragment = remaining.substring(unfinishedTool)
      const nameMatch = tagFragment.match(/name="([^"]*)"/)
      const statusMatch = tagFragment.match(/status="([^"]*)"/)
      const contentStart = tagFragment.indexOf('>') + 1
      
      blocks.push({
        id: `tool-${++blockIndex}`,
        type: 'tool_call',
        toolName: nameMatch?.[1] || "unknown",
        toolArgs: contentStart > 0 ? tagFragment.substring(contentStart) : "",
        status: (statusMatch?.[1] || "running") as 'running' | 'success' | 'error',
        streamState: 'streaming',
        displayMode: 'bubble',
      })
    } else {
      blocks.push({
        id: `text-${++blockIndex}`,
        type: 'text',
        content: remaining,
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

  return blocks
}
