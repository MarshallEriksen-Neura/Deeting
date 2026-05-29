# Deeting Relay 架构（IM Ingress Boundary）

> 适用范围：`deeting-relay/` 目录下的 Go 服务。
> 不覆盖：桌面端 Rust 运行时（见 [architecture-overview.md](./architecture-overview.md)）、云端后端（见 [deeting-core-architecture.md](./deeting-core-architecture.md)）。

本文档是 Deeting IM Relay 的架构说明书。Relay 是一个轻量级中转服务，作为 IM 平台（飞书、Telegram、钉钉、微信等）与 Deeting 桌面端之间的公网 ingress 边界。

## 1. TL;DR

`deeting-relay` 是一个 **单文件 Go 服务**（`main.go`），职责非常明确：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        deeting-relay 职责                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  公网 Ingress                                                   │    │
│  │  - 接收 IM 平台 Webhook（飞书/Telegram/钉钉/微信）              │    │
│  │  - 签名验证                                                     │    │
│  │  - 事件归一化                                                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  消息队列                                                       │    │
│  │  - 内存级事件队列                                               │    │
│  │  - 桌面端长轮询拉取                                             │    │
│  │  - 事件去重（Replay Guard）                                     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Agent 管理                                                     │    │
│  │  - 桌面端注册 Agent                                             │    │
│  │  - 心跳检测                                                     │    │
│  │  - 多 Agent 负载均衡                                            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  结果回传                                                       │    │
│  │  - 接收桌面端执行结果                                           │    │
│  │  - 调用 IM 平台 API 发送回复                                    │    │
│  │  - 卡片交互响应                                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**关键设计原则**：

| 原则 | 说明 |
|------|------|
| **不做 AI 执行** | Relay 不执行任何模型推理或工具调用 |
| **不持久化** | 内存级队列，无数据库依赖 |
| **安全边界** | 桌面端不暴露公网地址，IM 凭据不存入桌面端 |
| **轻量部署** | 单二进制，无外部依赖（除 IM 平台 API） |

## 2. 技术栈

| 组件 | 技术 |
|------|------|
| 语言 | Go 1.21+ |
| HTTP 框架 | 标准库 `net/http` |
| 部署 | Docker / 单二进制 |
| 存储 | 内存（无持久化） |

## 3. 架构边界

```
┌─────────────────────────────────────────────────────────────────────┐
│  IM 平台                                                            │
│  (飞书 / Telegram / 钉钉 / 微信)                                    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Webhook (POST)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  deeting-relay (公网)                                               │
│                                                                     │
│  - 接收事件                                                         │
│  - 签名验证                                                         │
│  - 归一化为 RelayEvent                                              │
│  - 存入内存队列                                                     │
│  - 发送回复                                                         │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Long Polling / WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Deeting 桌面端 (本地)                                              │
│                                                                     │
│  - 注册 Agent                                                       │
│  - 拉取事件                                                         │
│  - 执行 AI 推理 / 工具调用                                          │
│  - 返回结果                                                         │
└─────────────────────────────────────────────────────────────────────┘
```

## 4. 核心数据结构

### 4.1 RelayEvent（归一化事件）

```go
type RelayEvent struct {
    ID           string               `json:"id"`
    Platform     RelayPlatform        `json:"platform"`      // feishu/telegram/dingtalk/wechat
    Kind         RelayEventKind       `json:"kind"`          // message/interaction
    Conversation RelayConversationRef `json:"conversation"`  // 会话引用
    Sender       RelaySenderRef       `json:"sender"`        // 发送者
    Message      *RelayMessageRef     `json:"message"`       // 消息内容
    Interaction  *RelayInteractionRef `json:"interaction"`   // 交互内容
    Mentions     []RelayMention       `json:"mentions"`      // @提及
    PlatformMeta json.RawMessage      `json:"platform_meta"` // 平台特定元数据
    CreatedAt    time.Time            `json:"created_at"`
}
```

### 4.2 Agent（桌面端连接）

```go
type Agent struct {
    ID        string
    Name      string
    CreatedAt time.Time
    LastSeen  time.Time
    Events    []*RelayEvent  // 待处理事件队列
}
```

### 4.3 支持的平台

| 平台 | 状态 |
|------|------|
| 飞书 (Feishu/Lark) | ✅ 已实现 |
| Telegram | 🔄 预留 |
| 钉钉 (DingTalk) | 🔄 预留 |
| 微信 (WeChat) | 🔄 预留 |

## 5. API 路由

### 5.1 IM Webhook 入口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/feishu/events` | 飞书事件回调 |
| POST | `/feishu/card/callback` | 飞书卡片交互回调 |

### 5.2 桌面端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/agent/register` | 注册 Agent |
| POST | `/agent/heartbeat` | Agent 心跳 |
| GET | `/events/poll` | 长轮询拉取事件 |
| POST | `/events/ack` | 确认事件已处理 |
| POST | `/reply` | 发送回复消息 |
| POST | `/card/respond` | 响应卡片交互 |

### 5.3 健康检查

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/agents` | 列出在线 Agent |

## 6. 数据流

### 6.1 消息接收流程

```
飞书用户发送消息
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ POST /feishu/events                                                 │
│                                                                     │
│  1. 验证签名（FEISHU_CALLBACK_SECRET）                              │
│  2. 解析事件类型                                                    │
│  3. 去重检查（Replay Guard）                                        │
│  4. 归一化为 RelayEvent                                             │
│  5. 选择一个在线 Agent                                              │
│  6. 事件入队                                                        │
│  7. 返回 200 OK（飞书要求 3 秒内响应）                              │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 事件处理流程

```
桌面端 Agent
    │
    │ GET /events/poll?timeout=30s
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Relay 等待事件（长轮询）                                            │
│                                                                     │
│  - 有事件 → 立即返回                                                │
│  - 无事件 → 等待直到超时                                            │
└─────────────────────────────────────────────────────────────────────┘
    │
    │ 返回 RelayEvent[]
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 桌面端执行                                                          │
│                                                                     │
│  - AI 推理                                                          │
│  - 工具调用                                                         │
│  - 生成回复                                                         │
└─────────────────────────────────────────────────────────────────────┘
    │
    │ POST /reply
    │ { platform, conversation, content }
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Relay 发送回复                                                      │
│                                                                     │
│  - 调用飞书 API 发送消息                                            │
│  - 或更新卡片内容                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

## 7. 安全机制

### 7.1 签名验证

```go
// 飞书回调签名验证
func verifyFeishuSignature(timestamp, nonce, body string, signature string) bool {
    // SHA256(timestamp + nonce + FEISHU_CALLBACK_SECRET + body)
    content := timestamp + nonce + feishuCallbackSecret + body
    hash := sha256.Sum256([]byte(content))
    expected := base64.StdEncoding.EncodeToString(hash[:])
    return hmac.Equal([]byte(signature), []byte(expected))
}
```

### 7.2 共享密钥

桌面端与 Relay 之间通过 `X-Relay-Secret` Header 验证身份：

```
桌面端 ──── X-Relay-Secret: <RELAY_SHARED_SECRET> ────▶ Relay
```

### 7.3 事件去重

Replay Guard 防止同一事件被重复处理：

```go
var feishuReplayGuard = struct {
    mu      sync.Mutex
    entries map[string]time.Time
}{
    entries: make(map[string]time.Time),
}
```

## 8. 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `RELAY_HTTP_ADDR` | HTTP 监听地址 | `:8080` |
| `RELAY_SHARED_SECRET` | 桌面端共享密钥 | - |
| `FEISHU_CALLBACK_SECRET` | 飞书回调签名密钥 | - |
| `FEISHU_BOT_APP_ID` | 飞书应用 App ID | - |
| `FEISHU_BOT_APP_SECRET` | 飞书应用 App Secret | - |

## 9. 部署

### 9.1 直接运行

```bash
cd deeting-relay
export RELAY_HTTP_ADDR=":8080"
export RELAY_SHARED_SECRET="your-secret"
export FEISHU_CALLBACK_SECRET="your-feishu-secret"
export FEISHU_BOT_APP_ID="cli_xxx"
export FEISHU_BOT_APP_SECRET="xxx"
go run .
```

### 9.2 Docker

```bash
docker build -t deeting-relay:latest .
docker run -d -p 8080:8080 \
  -e RELAY_SHARED_SECRET="your-secret" \
  -e FEISHU_BOT_APP_ID="cli_xxx" \
  -e FEISHU_BOT_APP_SECRET="xxx" \
  deeting-relay:latest
```

### 9.3 Docker Compose

```bash
docker compose up -d
```

## 10. 与桌面端集成

### 10.1 桌面端配置

在 Deeting 桌面端设置页的"桌面 Relay 转发"卡片中配置：

| 配置项 | 说明 |
|--------|------|
| Relay 服务地址 | `https://your-relay.example.com` |
| 共享密钥 | 与 `RELAY_SHARED_SECRET` 一致 |

### 10.2 飞书配置

1. 在飞书开放平台创建应用机器人
2. 配置事件回调地址：`https://your-relay.example.com/feishu/events`
3. 配置卡片回调地址：`https://your-relay.example.com/feishu/card/callback`
4. 获取 App ID 和 App Secret

### 10.3 通信协议

```
桌面端 → Relay:
  POST /agent/register
  Header: X-Relay-Secret: <secret>
  Body: { "name": "desktop-1" }

  GET /events/poll?timeout=30s
  Header: X-Relay-Secret: <secret>
  
  POST /reply
  Header: X-Relay-Secret: <secret>
  Body: {
    "platform": "feishu",
    "conversation": { "id": "oc_xxx" },
    "content": { "type": "text", "text": "Hello!" }
  }
```

## 11. 当前实现状态

| 功能 | 状态 |
|------|------|
| 飞书消息事件接收 | ✅ 已实现 |
| 飞书卡片交互回调 | ✅ 已实现 |
| 桌面端轮询消费 | ✅ 已实现 |
| 文本回复发送 | ✅ 已实现 |
| 卡片更新 | 🔄 待增强 |
| Telegram 支持 | 🔄 预留 |
| 多事件持久化 | 🔄 待增强 |

## 12. 安全建议

1. **使用高熵密钥**：`RELAY_SHARED_SECRET` 和 `FEISHU_CALLBACK_SECRET` 应使用随机生成的高熵字符串
2. **HTTPS 必选**：生产环境必须使用 HTTPS
3. **网络隔离**：内网部署时绑定 `127.0.0.1:8080`，通过反向代理暴露给飞书
4. **凭据隔离**：`FEISHU_BOT_APP_ID` / `FEISHU_BOT_APP_SECRET` 只存在 Relay，不存入桌面端

## 13. 文件地图

| 我想… | 看这里 |
|-------|--------|
| 改 Webhook 处理 | `main.go` 中 `handleFeishuEvents` |
| 改卡片回调 | `main.go` 中 `handleFeishuCardCallback` |
| 改 Agent 管理 | `main.go` 中 `Agent` 相关代码 |
| 改事件队列 | `main.go` 中 `RelayState` |
| 改回复发送 | `main.go` 中 `sendFeishuReply` |
| 改环境变量 | `main.go` 中 `RelayConfig` |