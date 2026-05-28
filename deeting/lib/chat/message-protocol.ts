export type BlockType =
  | 'text'
  | 'thought'
  | 'capability_transition'
  | 'tool_call'
  | 'tool_result'
  | 'console_log'
  | 'execution_section'
  | 'flight_offer'
  | 'file_preview'
  | 'error'
  | 'ui'
  | 'activity_timeline'
  | 'diting_think_frame'

export type BlockStreamState = 'streaming' | 'completed'

export type BlockDisplayMode = 'bubble' | 'widget' | 'canvas'

export interface BaseBlock {
  id: string
  type: BlockType
  callId?: string
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

export interface CapabilityTransitionBlock extends BaseBlock {
  type: 'capability_transition'
  action: 'activated' | 'deactivated' | 'updated'
  capabilityId?: string
  capabilityName?: string
  reason?: string
}

export interface ToolCallBlock extends BaseBlock {
  type: 'tool_call'
  // Correlates tool_call <-> tool_result across streaming updates.
  // We intentionally keep this optional to allow older persisted payloads.
  callId?: string
  toolName?: string
  toolArgs?: string
  status?: 'running' | 'success' | 'error' | 'requires_approval'
}

export interface ToolResultBlock extends BaseBlock {
  type: 'tool_result'
  callId?: string
  toolName?: string
  status?: 'success' | 'error' | 'requires_approval'
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
  callId?: string
  toolName?: string
  viewType: string
  payload: unknown
  title?: string
  metadata?: Record<string, unknown>
}

export interface RuntimeActivityEvent {
  id: string
  messageId: string
  stage: 'listen' | 'remember' | 'evolve' | 'render' | 'tool' | 'approval' | 'recovery'
  level: 'info' | 'success' | 'warning' | 'error' | 'action'
  title: string
  detail?: string
  status: 'running' | 'done' | 'failed' | 'cancelled' | 'waiting'
  timestamp: number
  source:
    | 'status'
    | 'tool_call'
    | 'tool_result'
    | 'runtime_transition'
    | 'execution_lifecycle'
    | 'world_model'
    | 'context_pressure'
  critical?: boolean
  collapsible?: boolean
  debug?: unknown
}

export interface ActivityTimelineBlock extends BaseBlock {
  type: 'activity_timeline'
  events: RuntimeActivityEvent[]
  collapsed?: boolean
  summary?: string
}

export interface DitingThinkFrameBlock extends BaseBlock {
  type: 'diting_think_frame'
  intent: string | null
  facts: string[]
  assumptions: string[]
  verificationTargets: string[]
  rules: string[]
}

export interface HtmlRuntimePayload {
  asset_id?: string
  snapshot_html?: string
  html?: string
  summary?: string
  render_hint?: string
  render_data?: unknown
  initial_data?: unknown
  refresh_spec?: HtmlRuntimeRefreshSpec
}

export interface HtmlRuntimeRefreshSpec {
  kind: string
  target?: string
  input?: unknown
}

export interface HtmlRuntimeMetadata {
  asset_id?: string
  data_mode?: string
  html_entry?: string
  render_hint?: string
  runtime_mode?: 'html_static' | 'html_interactive' | 'trusted_local_bundle'
  template_id?: string
  template_source?: string
  template_version?: string
  schema_fingerprint?: string
  cache_key?: string
  snapshot_mode?: 'frozen'
  snapshot_created_at?: string
  live_channel_id?: string
  refresh_interval_ms?: number
  expires_at_ms?: number
  has_refresh_spec?: boolean
  allow_live_updates?: boolean
  iframe_height?: number
}

export type MessageBlock =
  | TextBlock
  | ThoughtBlock
  | CapabilityTransitionBlock
  | ToolCallBlock
  | ToolResultBlock
  | ConsoleLogBlock
  | ExecutionSectionBlock
  | FlightOfferBlock
  | FilePreviewBlock
  | ErrorBlock
  | UIBlock
  | ActivityTimelineBlock
  | DitingThinkFrameBlock

export interface PersistedMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number
  tool_calls?: Array<{ id: string; name: string; args: unknown }>
  tool_outputs?: Array<{ call_id: string; result: unknown }>
}
