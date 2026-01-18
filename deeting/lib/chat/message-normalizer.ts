import type { MessageBlock } from '@/lib/chat/message-protocol'

const THINK_REGEX = /<think>([\s\S]*?)<\/think>/g

export function normalizeMessage(
  content: string,
  toolOutputs?: Array<{ call_id: string; result: unknown }>
): MessageBlock[] {
  const blocks: MessageBlock[] = []
  let lastIndex = 0
  let textIndex = 0
  let thoughtIndex = 0
  let match: RegExpExecArray | null

  while ((match = THINK_REGEX.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const text = content.substring(lastIndex, match.index)
      if (text.trim()) {
        blocks.push({
          id: `text-${textIndex += 1}`,
          type: 'text',
          content: text,
          streamState: 'completed',
          displayMode: 'bubble',
        })
      }
    }
    blocks.push({
      id: `thought-${thoughtIndex += 1}`,
      type: 'thought',
      content: match[1].trim(),
      streamState: 'completed',
      displayMode: 'bubble',
    })
    lastIndex = THINK_REGEX.lastIndex
  }

  if (lastIndex < content.length) {
    const text = content.substring(lastIndex)
    if (text.trim()) {
      blocks.push({
        id: `text-${textIndex += 1}`,
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
