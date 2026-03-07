export type BlockType =
  | 'text'
  | 'thought'
  | 'assistant_transition'
  | 'tool_call'
  | 'tool_result'
  | 'console_log'
  | 'execution_section'
  | 'flight_offer'
  | 'file_preview'
  | 'error'
  | 'ui'

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

export interface AssistantTransitionBlock extends BaseBlock {
  type: 'assistant_transition'
  action: 'activated' | 'deactivated' | 'updated'
  assistantId?: string
  assistantName?: string
  reason?: string
}

export interface ToolCallBlock extends BaseBlock {
  type: 'tool_call'
  // Correlates tool_call <-> tool_result across streaming updates.
  // We intentionally keep this optional to allow older persisted payloads.
  callId?: string
  toolName?: string
  toolArgs?: string
  status?: 'running' | 'success' | 'error'
}

export interface ToolResultBlock extends BaseBlock {
  type: 'tool_result'
  callId?: string
  toolName?: string
  status?: 'success' | 'error'
  result?: unknown
  ui?: unknown
  debug?: Record<string, unknown>
}

export interface ConsoleLogBlock extends BaseBlock {
  type: 'console_log'
  stream?: 'stdout' | 'stderr'
  content: string
}

export interface ExecutionSectionBlock extends BaseBlock {
  type: 'execution_section'
  title: string
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

export interface UIBlock extends BaseBlock {
  type: 'ui'
  viewType: string
  payload: unknown
  title?: string
  metadata?: Record<string, unknown>
}

export type MessageBlock =
  | TextBlock
  | ThoughtBlock
  | AssistantTransitionBlock
  | ToolCallBlock
  | ToolResultBlock
  | ConsoleLogBlock
  | ExecutionSectionBlock
  | FlightOfferBlock
  | FilePreviewBlock
  | ErrorBlock
  | UIBlock

export interface PersistedMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  tool_calls?: Array<{ id: string; name: string; args: unknown }>
  tool_outputs?: Array<{ call_id: string; result: unknown }>
}
