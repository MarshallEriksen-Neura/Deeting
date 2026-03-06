# deeting-relay

轻量级的中转服务，用于把飞书等 IM 回调事件转发给本地 Deeting 桌面端，再由桌面端使用本地模型/工具执行，并通过机器人回复消息。

> 典型场景：
> - 在自己的 VPS / 内网部署 `deeting-relay`
> - 飞书应用机器人回调指向 `deeting-relay`
> - Deeting 桌面端配置好 Relay 地址和密钥后，可以在飞书里 @ 机器人，机器人由本地 AI 回答。

---

## 功能概览

- 接收飞书应用机器人事件回调：`POST /feishu/events`
- 简单签名校验（可选，依赖 `FEISHU_CALLBACK_SECRET`）
- 将消息事件写入内存队列，供桌面端长轮询拉取
- 接收来自桌面端的回复，并调用飞书开放平台发送文本消息
- 内存级 agent/事件管理，没有持久化依赖，部署非常轻量

---

## 环境变量配置

`deeting-relay` 通过环境变量进行配置：

- `RELAY_HTTP_ADDR`（可选）
  - HTTP 监听地址
  - 默认：`":8080"`

- `RELAY_SHARED_SECRET`（推荐配置）
  - 桌面端与 relay 通信使用的共享密钥
  - 桌面端会在请求时带上 `X-Relay-Secret: <RELAY_SHARED_SECRET>`

- `FEISHU_CALLBACK_SECRET`（可选但强烈推荐）
  - 飞书回调签名密钥
  - 需要与飞书开发者后台中配置的签名 secret 一致
  - 若未配置，将跳过签名校验

- `FEISHU_BOT_APP_ID` / `FEISHU_BOT_APP_SECRET`（必填，用于发送消息）
  - 飞书应用机器人的 app_id / app_secret
  - relay 使用这两个值换取 tenant_access_token，并调用
    `https://open.feishu.cn/open-apis/im/v1/messages` 发送回复。

---

## 本地运行（Go 环境）

```bash
cd deeting-relay

export RELAY_HTTP_ADDR=":8080"
export RELAY_SHARED_SECRET="your-strong-secret"
export FEISHU_CALLBACK_SECRET="your-feishu-callback-secret"
export FEISHU_BOT_APP_ID="cli_xxx"
export FEISHU_BOT_APP_SECRET="xxx"

go run ./...
# 或构建二进制
go build -o deeting-relay .
./deeting-relay
```

启动后，服务默认监听在 `0.0.0.0:8080`。

---

## Docker 构建与运行

### 使用 Dockerfile 构建

在 `deeting-relay` 目录下提供了一个简单的多阶段构建 Dockerfile：

```bash
cd deeting-relay
docker build -t deeting-relay:latest .
```

运行容器：

```bash
docker run -d --name deeting-relay \
  -p 8080:8080 \
  -e RELAY_HTTP_ADDR=":8080" \
  -e RELAY_SHARED_SECRET="your-strong-secret" \
  -e FEISHU_CALLBACK_SECRET="your-feishu-callback-secret" \
  -e FEISHU_BOT_APP_ID="cli_xxx" \
  -e FEISHU_BOT_APP_SECRET="xxx" \
  deeting-relay:latest
```

### 使用 docker-compose

`deeting-relay/docker-compose.yaml` 提供了一个示例：

```bash
cd deeting-relay
docker compose up -d
```

在 compose 文件中填好自己的环境变量即可。

---

## 与 Deeting 桌面端联动

1. **部署 relay**：
   - 按上面的方式在 VPS / 内网启动 `deeting-relay`，假设外网可访问地址为：
     - `https://your-relay.example.com`

2. **配置飞书应用回调**：
   - 在飞书开放平台中，将应用机器人事件回调地址指向：
     - `https://your-relay.example.com/feishu/events`
   - 配置签名 secret，与 `FEISHU_CALLBACK_SECRET` 保持一致。

3. **配置 Deeting 桌面端**：
   - 打开桌面端 Settings → 桌面设置 → “桌面 Relay 转发” 卡片
   - 填写：
     - Relay 服务地址：`https://your-relay.example.com`
     - 共享密钥：与 `RELAY_SHARED_SECRET` 相同
   - 保存后，桌面端会使用该地址和密钥注册为一个 agent，并通过长轮询拉取 Feishu 事件。

4. **体验**：
   - 在飞书里 @ 你的机器人或私聊机器人发送文本消息
   - 事件经过 `deeting-relay` 转发到本地 Deeting 桌面端
   - 桌面端使用本地配置的“秘书模型”生成回复，再通过 relay 调用飞书开放平台发回消息。

---

## 安全建议

- 强烈建议：
  - 为 `RELAY_SHARED_SECRET` 使用高熵随机字符串；
  - 为 `FEISHU_CALLBACK_SECRET` 使用与飞书后台一致的随机 secret；
  - 在防火墙 / 安全组中只开放必要端口。
- 若只在内网使用，可将 `RELAY_HTTP_ADDR` 绑定为内网地址，例如：`"127.0.0.1:8080"`，再通过反向代理暴露给飞书。

