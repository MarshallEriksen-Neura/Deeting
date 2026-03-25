# Desktop Topic Naming And Summary Design

## Goal

- 为桌面端本地聊天补齐自动话题命名。
- 让桌面端对话摘要复用现有模型请求封装，而不是单独维护另一套请求路径。

## Decision

- 话题命名：在桌面本地聊天首轮 assistant 落库后，后台异步生成标题并回写本地 `conversation_session.title`。
- 对话摘要：保留现有 `summary_job + idle_task + worker` 异步架构，但 worker 优先走模型摘要，失败时回退本地拼接摘要。
- 请求复用：统一复用桌面端已有的 `resolve_local_model_connection()` 与 `request_provider_chat_completion()`。

## Data Model

- 在本地 `conversation_session` 增加：
  - `last_model_id`
  - `last_provider_model_id`
- 每次桌面本地聊天 resolve 出模型后，把这两个字段写入当前会话，供后续异步摘要 worker 读取。

## Flow

### Topic Naming

1. 本地聊天 resolve 当前模型。
2. 写入会话模型上下文。
3. assistant 消息落库成功后，后台读取当前会话标题上下文。
4. 若标题为空且仍处于首轮，则复用统一请求封装生成标题。
5. 仅在标题为空时回写，避免覆盖手动重命名。

### Conversation Summary

1. 继续由现有 `append_local_conversation_message()` 触发 idle task / flush。
2. summary worker 拉取 job 后，读取 runtime window。
3. 若 window meta 里存在最近一次会话模型上下文，则优先走模型摘要。
4. 模型摘要失败或上下文缺失时，回退到本地字符串摘要。

## UI

- 历史侧边栏在打开时立即刷新，并在打开期间做轻量轮询，便于后台标题回写后尽快显示。

## Validation

- `cargo check --message-format short`
- 相关 store 级测试覆盖模型上下文回写与标题只在为空时写入
