# 通知渠道 API

## 鉴权

- 全部接口需要登录态（`Bearer Token`）。

## 端点

- `GET /api/v1/notification-channels`：查询当前用户渠道列表
- `POST /api/v1/notification-channels`：创建渠道
- `GET /api/v1/notification-channels/{channel_id}`：查询单个渠道
- `PATCH /api/v1/notification-channels/{channel_id}`：更新渠道
- `DELETE /api/v1/notification-channels/{channel_id}`：删除渠道
- `POST /api/v1/notification-channels/test`：测试发送

## 错误码约定

- `400 Bad Request`：配置不合法、渠道类型不支持、业务校验失败
- `404 Not Found`：渠道不存在（或不属于当前用户）

说明：

- 接口层统一返回 HTTPException，不再直接抛出 `ValueError` 导致 `500`。
- `GET /api/v1/notification-channels/{channel_id}` 返回 `config` 字段（当前用户可编辑配置）。

## Feishu 扩展配置（多用户/多群）

`feishu` 渠道的 `config` 除 `webhook_url` 外，支持以下可选字段：

- `chat_ids: string[]`：多个群 chat_id（每个渠道可绑定多群）
- `chat_id: string`：单个群 chat_id（兼容写法）
- `bot_open_id: string`：机器人 open_id，用于精准识别 @ 目标
- `bot_model: string`：该渠道机器人回复模型（渠道级覆盖）
- `bot_system_prompt: string`：该渠道机器人系统提示词（渠道级覆盖）
- `bot_app_id: string` / `bot_app_secret: string`：渠道级飞书应用凭据（覆盖环境变量）
