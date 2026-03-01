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
