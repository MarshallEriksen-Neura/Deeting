export type BlockType =
  | 'text'
  | 'thought'
  | 'tool_call'
  | 'tool_result'
  | 'flight_offer'
  | 'file_preview'
  | 'error'

export type BlockStreamState = 'streaming' | 'completed'

export type BlockDisplayMode = 'bubble' | 'widget' | 'canvas'

export interface BaseBlock {
  id: string
  type: BlockType
  streamState?: BlockStreamState
  displayMode?: BlockDisplayMode
}

export interface TextBlock extends BaseBlock {
  type: 'text'
  content: string
}

export interface ThoughtBlock extends BaseBlock {
  type: 'thought'
  content: string
  cost?: string
}

export interface ToolCallBlock extends BaseBlock {
  type: 'tool_call'
  toolName?: string
  toolArgs?: string
  status?: 'running' | 'success' | 'error'
}

export interface ToolResultBlock extends BaseBlock {
  type: 'tool_result'
  callId?: string
  result?: unknown
}

export interface FlightOfferBlock extends BaseBlock {
  type: 'flight_offer'
  data: Record<string, unknown>
}

export interface FilePreviewBlock extends BaseBlock {
  type: 'file_preview'
  data: Record<string, unknown>
}

export interface ErrorBlock extends BaseBlock {
  type: 'error'
  message: string
}

export type MessageBlock =
  | TextBlock
  | ThoughtBlock
  | ToolCallBlock
  | ToolResultBlock
  | FlightOfferBlock
  | FilePreviewBlock
  | ErrorBlock

export interface PersistedMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  tool_calls?: Array<{ id: string; name: string; args: unknown }>
  tool_outputs?: Array<{ call_id: string; result: unknown }>
}
