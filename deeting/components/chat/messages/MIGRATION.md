# Chat Messages 接入指南（Block-First）

本文档描述当前聊天消息模块的唯一接入方式：**block-first**。  
开发环境不再维护旧渲染协议或旧导入路径。

## 1. 导入方式

统一从以下入口导入：

```tsx
import { ChatMessageList, MessageItem } from "@/components/chat/messages"
```

## 2. 渲染协议

- assistant 消息以 `message.blocks` 为唯一渲染来源。
- `message.content` 仅作为辅助文本（复制、检索等），不再反向驱动 UI。
- 错误态使用 `error block` 渲染，不再回退为纯文本覆盖。

## 3. SSE / 流式处理约定

- 增量块：`appendMessageBlocks(messageId, blocks)`
- 全量覆盖：`setMessageBlocks(messageId, blocks)`
- 元信息补丁：`mergeMessageMeta(messageId, patch)`（例如 `trace_id`）

## 4. 推荐验证项

- assistant 消息在流式和非流式下都只依赖 blocks 渲染。
- tool_call 与 tool_result 通过 `callId` 正确关联状态。
- error block 能在消息列表和复制动作中正确呈现。
- history 回放时 `meta_info.blocks` 能复现完整 UI。

## 5. 常见问题

### 为什么不保留旧兼容逻辑？

当前阶段以开发效率和可维护性优先。保留多套协议会引入状态漂移和维护复杂度，block-first 更容易保证一致性。
