# deeting-relay

轻量级中转服务，用于把飞书等 IM 回调事件转发给本地 Deeting 桌面端，再由桌面端使用本地模型或工具执行，并通过机器人回复消息。

> 独立仓库：`https://github.com/MarshallEriksen-Neura/deeting_relay`
>
> 如果你当前是在 Deeting 主仓里查看这个目录，请先进入 `deeting-relay/` 再执行下面的命令；如果你是从独立仓库克隆下来的，直接在仓库根目录执行即可。

## 功能概览

- 接收飞书应用机器人事件回调：`POST /feishu/events`
- 简单签名校验（可选，依赖 `FEISHU_CALLBACK_SECRET`）
- 将消息事件写入内存队列，供桌面端长轮询拉取
- 接收来自桌面端的回复，并调用飞书开放平台发送文本消息
- 内存级 agent/事件管理，没有持久化依赖，部署非常轻量

## 环境变量配置

- `RELAY_HTTP_ADDR`
  - HTTP 监听地址
  - 默认值：`":8080"`

- `RELAY_SHARED_SECRET`
  - 桌面端与 relay 通信使用的共享密钥
  - 桌面端会在请求时带上 `X-Relay-Secret: <RELAY_SHARED_SECRET>`

- `FEISHU_CALLBACK_SECRET`
  - 飞书回调签名密钥
  - 需要与飞书开发者后台中配置的签名 secret 一致
  - 若未配置，将跳过签名校验

- `FEISHU_BOT_APP_ID` / `FEISHU_BOT_APP_SECRET`
  - 飞书应用机器人的 `app_id` / `app_secret`
  - relay 使用这两个值换取 `tenant_access_token`，并调用飞书开放平台发送回复

## 本地运行

如果你还没有克隆独立仓库，可以直接使用：

```bash
git clone https://github.com/MarshallEriksen-Neura/deeting_relay.git
cd deeting_relay
```

配置环境变量并启动：

```bash
export RELAY_HTTP_ADDR=":8080"
export RELAY_SHARED_SECRET="your-strong-secret"
export FEISHU_CALLBACK_SECRET="your-feishu-callback-secret"
export FEISHU_BOT_APP_ID="cli_xxx"
export FEISHU_BOT_APP_SECRET="xxx"

go run .
```

构建二进制：

```bash
go build -o deeting-relay .
./deeting-relay
```

服务默认监听 `0.0.0.0:8080`。

## Docker

构建镜像：

```bash
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

使用 `docker compose`：

```bash
docker compose up -d
```

直接修改仓库内的 `docker-compose.yaml` 里的环境变量即可。

## 与 Deeting 桌面端联动

1. 部署 relay，假设外网地址为 `https://your-relay.example.com`
2. 在飞书开放平台中，将机器人事件回调地址配置为 `https://your-relay.example.com/feishu/events`
3. 在 Deeting 桌面端设置页的“桌面 Relay 转发”卡片中填写：
   - Relay 服务地址：`https://your-relay.example.com`
   - 共享密钥：与 `RELAY_SHARED_SECRET` 一致
4. 保存后，桌面端会注册 agent，并通过长轮询拉取 Feishu 事件

## 安全建议

- 为 `RELAY_SHARED_SECRET` 使用高熵随机字符串
- 为 `FEISHU_CALLBACK_SECRET` 使用与飞书后台一致的随机 secret
- 在防火墙或安全组中只开放必要端口
- 若只在内网使用，可将 `RELAY_HTTP_ADDR` 绑定为 `127.0.0.1:8080`，再通过反向代理暴露给飞书

## 从主仓拆分到独立仓库

如果你想从当前 Deeting 主仓直接把这个目录推送到新的独立仓库，可以在主仓根目录执行：

```bash
git subtree split --prefix=deeting-relay -b deeting-relay-split
git push https://github.com/MarshallEriksen-Neura/deeting_relay.git deeting-relay-split:main
```

如果远端默认分支不是 `main`，把最后一条命令里的目标分支替换掉即可。
