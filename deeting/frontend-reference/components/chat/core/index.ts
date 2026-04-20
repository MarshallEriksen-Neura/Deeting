/**
 * Chat Core 模块
 * 
 * 提供聊天功能的核心层，包括：
 * - 消息数据管理
 * - UI 状态管理
 * - 配置和会话状态管理
 * - 容器组件
 * 
 * 这些 Context 作为 Zustand store 的包装层，提供：
 * 1. 依赖注入能力
 * 2. 组件间通信
 * 3. 性能优化（通过拆分减少重渲染）
 */

// Container 组件
export { ChatContainer } from "./chat-container"

// Layout 组件
export { ChatLayout } from "./chat-layout"

// Error Boundary 组件
export { ChatErrorBoundary } from "./chat-error-boundary"

// Provider 组件
export { ChatProvider } from "./chat-provider"
export { ChatMessagesProvider } from "./chat-messages-context"
export { ChatUIStateProvider } from "./chat-ui-state-context"
export { ChatConfigProvider } from "./chat-config-context"

// Hooks
export { useChatMessages } from "./chat-messages-context"
export { useChatUIState } from "./chat-ui-state-context"
export { useChatConfig } from "./chat-config-context"

// Types
export type { ChatMessagesContextValue } from "./chat-messages-context"
export type { ChatUIStateContextValue } from "./chat-ui-state-context"
export type { ChatConfigContextValue } from "./chat-config-context"
