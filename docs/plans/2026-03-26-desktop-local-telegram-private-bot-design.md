# Desktop Local Telegram Private Bot Design

Date: 2026-03-26

## Summary

桌面端 Telegram 一期应采用 `desktop local` 直连方案，在现有“通知渠道”入口内同时承载两类能力：

- 主动推送：monitor 任务通过 Telegram Bot API 向指定私聊 `chat_id` 发送通知
- 双向私聊 bot：桌面端通过 `getUpdates` 长轮询收取用户私聊消息，并在本地完成执行后直接回复

本轮不引入 `deeting-relay`，也不启用 Telegram webhook。桌面端直接持有 `bot_token`，既用于主动推送，也用于私聊 bot 收发消息。

## Why now

当前桌面端已经具备 Telegram 的两块基础能力，但链路还没有真正打通：

- `monitor` 模块已支持 Telegram 主动推送
- `im/telegram/client.rs` 已有 Telegram 长轮询客户端

真正缺失的是把 Telegram 正式接入桌面 IM runtime，并让它沿用现有通知渠道作为唯一配置入口。  
如果继续把主动推送和私聊 bot 分成两套配置面，后面会重复管理 `bot_token`、启停状态和错误提示。

## Goals

- 让 Telegram 渠道在桌面端只配置一次，就能同时支持主动推送和私聊 bot。
- 让 Telegram 私聊消息进入现有本地 chat 执行链，而不是新开一套对话业务。
- 保持当前 monitor 的 Telegram 主动推送链路不回退。
- 明确区分“配置存在”和“桌面 IM 已实际运行”的状态。
- 在 UI 上把 Telegram 的推送用途和私聊 bot 用途讲清楚。

## Non-Goals

- 本轮不做 Telegram 群聊、超级群、频道回复。
- 本轮不做群内 `@bot` 触发。
- 本轮不做 Telegram webhook 模式。
- 本轮不引入 `deeting-relay` 或任何云端转发层。
- 本轮不支持图片、文件、语音等 Telegram 富媒体输入。

## Current seams

### 1. Telegram 主动推送已经存在

桌面 monitor 已支持：

- 从本地通知渠道读取 `bot_token` 与 `chat_id`
- 直接调用 Telegram `sendMessage`

因此主动推送不是从零开始，重点是避免新方案破坏现有通知链路。

### 2. Telegram IM client 已具备长轮询能力

`deeting/src-tauri/src/modules/im/telegram/client.rs` 已实现：

- `getUpdates`
- `sendMessage`
- `answerCallbackQuery`
- 消息/回调事件转换为统一 `ImEvent`

这说明 Telegram 私聊 bot 的传输层可以直连，不需要 relay。

### 3. Runtime 目前只会从通知渠道派生 Feishu profile

当前 `deeting/src-tauri/src/modules/im/runtime.rs` 中：

- `derive_profile_from_notification_channel()` 只识别 `feishu`
- IM worker 也只真正启动 Feishu direct profile

这才是 Telegram 桌面双向能力未完成的真实原因。

## Transport decision

### Telegram 第一版使用 direct long polling

采用：

- 桌面端 `getUpdates` 长轮询
- 桌面端 `sendMessage` 直接回包

不采用：

- `setWebhook`
- `deeting-relay`

原因：

- Telegram 官方 API 已支持 `getUpdates`，桌面端不需要公网回调入口
- 现有 `TelegramClient` 已按这个模式实现
- 用户当前明确要求只做桌面端

### 需要显式暴露的运行前提

如果该 bot 之前已设置 Telegram webhook，则 `getUpdates` 不会正常工作。  
因此产品和运行时都应明确区分：

- `bot_token` 已保存
- 桌面 Telegram IM 已启动
- 桌面 Telegram IM 实际能收到更新

不能把“已配置”误说成“已运行”。

## Target architecture

### 1. 单一配置入口

继续使用“通知渠道”页作为唯一入口。Telegram 渠道新增或明确以下字段语义：

- `bot_token`
  - 主动推送与私聊 bot 共用
- `chat_id`
  - 仅用于主动推送目标
- `im_enabled`
  - 决定桌面端是否启动 Telegram 私聊 bot

不新增单独的 Telegram 设置页。

### 2. 配置职责分离

同一条 Telegram notification channel 记录，承担两类职责：

- monitor
  - 读取 `bot_token + chat_id`
  - 进行主动推送
- IM runtime
  - 读取 `bot_token + im_enabled`
  - 启动私聊 bot 长轮询

共享存储，不共享业务语义。

### 3. Profile derivation

`im/runtime.rs` 需要从 Telegram 通知渠道派生 `ImConnectionProfile`：

- `platform = ImPlatform::Telegram`
- `enabled = channel.is_active && im_enabled == true`
- `direct_config.telegram_bot_token = bot_token`
- `transport_preference = Auto`

Telegram 第一版不派生 relay config，也不显示 relay 路径。

### 4. Runtime worker

新增 Telegram direct worker，整体结构与 Feishu worker 对齐：

1. 启动 `TelegramClient`
2. 接收 `ImEvent`
3. 仅处理 `chat_type == private` 的文本消息
4. 进入本地 chat 执行链
5. 将结果通过 `sendMessage` 回到同一私聊会话

### 5. Session strategy

私聊 bot 的会话隔离沿用当前 IM 会话思路：

- `session_id = im:{profile_id}:chat:{chat_id}`

这样每个 Telegram 私聊都是独立的本地 chat 上下文，不与其他平台或其他用户串线。

## Message handling rules

### Supported input

一期只接受：

- Telegram 私聊文本消息

### Ignored input

以下内容直接忽略或给出轻量提示：

- 群聊消息
- 频道消息
- 图片
- 文件
- 语音
- 其他非文本输入

### Reply behavior

回复继续走现有本地 chat 生成链路，不新建 Telegram 专属业务层。  
如本地执行失败，应向用户返回简短失败提示，而不是让轮询链路静默失败。

## UI and product behavior

### Notification channel form

Telegram 表单应明确区分：

- `chat_id`：主动推送目标
- `bot_token`：主动推送和私聊 bot 共用凭据
- `im_enabled`：开启桌面端私聊 bot

### Runtime status hint

当前通知渠道页已有 Feishu 的桌面 IM 状态提示。  
Telegram 一期应补齐相同级别的可读状态：

- 已禁用
- 已启用但 token 缺失
- 已启用并尝试 direct
- 运行失败（例如 webhook 冲突）

重点是让用户知道 Telegram IM 是不是“真的在跑”。

## Failure handling

### 1. Missing token

- `bot_token` 缺失时，不启动 Telegram IM
- 主动推送测试也应继续按现有校验报错

### 2. Webhook conflict

- 如果 Telegram bot 已设置 webhook，长轮询无法正常工作
- 第一版至少要把错误显式暴露出来
- 不能以“连接中”长期伪装成功

### 3. Disabled IM

- `im_enabled = false` 时，不启动私聊 bot
- 主动推送仍然可用

### 4. Non-private messages

- 非私聊消息不进入本地 chat 执行链
- 第一版不试图做群聊兼容分支

## Verification boundaries

### Configured

只能证明：

- 本地通知渠道里已保存 Telegram 配置

### Operational

只有当以下条件成立时，才能算 Telegram 桌面双向链路真的工作：

- 桌面端实际启动 Telegram client
- Telegram client 成功轮询到更新
- 私聊文本消息进入本地 chat 链路
- 桌面端成功回发回复

## Acceptance criteria

- 用户只在“通知渠道”页配置一次 Telegram。
- 同一份 `bot_token` 同时支持主动推送和私聊 bot。
- 桌面端不依赖 `deeting-relay`，直接通过 Telegram API 工作。
- 私聊 bot 只处理 `private` 文本消息。
- `im_enabled=false` 时，主动推送仍可工作，但双向私聊 bot 不启动。
- 运行失败时能给出明确、可理解的状态或错误提示。

## Files expected to change in implementation

- `deeting/src-tauri/src/modules/im/runtime.rs`
- `deeting/src-tauri/src/modules/im/profile.rs`
- `deeting/src-tauri/src/modules/im/telegram/client.rs`
- `deeting/lib/api/notification-channels.ts`
- `deeting/lib/api/desktop-im.ts`
- `deeting/app/[locale]/dashboard/notification-channels/components/channels-client.tsx`

