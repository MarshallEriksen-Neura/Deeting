export interface ConsoleMessage {
  id: string
  type: 'user' | 'system' | 'agent'
  content: string
  timestamp: string
}
