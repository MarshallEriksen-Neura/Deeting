# MCP 供应链订阅 API（云端）

用于 Web 端订阅外部 MCP Provider 配置（JSON with `mcpServers`），并一键同步入库。

## 1. 订阅源管理

- `GET /mcp/sources`
  - 说明：列出当前用户的 MCP 订阅源
  - 响应：`UserMcpSourceResponse[]`

- `POST /mcp/sources`
  - 说明：创建一个 MCP 订阅源
  - 请求体：
    - `name`: 名称
    - `source_type`: `modelscope` | `github` | `url` | `cloud` | `local`
    - `path_or_url`: 订阅地址（HTTP/HTTPS）
    - `trust_level`: `official` | `community` | `private`
  - 响应：`UserMcpSourceResponse`

- `DELETE /mcp/sources/{source_id}`
  - 说明：删除订阅源（级联删除该源同步产生的 MCP servers）
  - 响应：`204 No Content`

## 2. 同步订阅源

- `POST /mcp/sources/{source_id}/sync`
  - 说明：拉取订阅源 JSON 并批量入库 `mcpServers`
  - 请求体：
    - `auth_token`: 可选的访问令牌（Bearer）
  - 响应：`McpSourceSyncResponse`
    - `source`: `UserMcpSourceResponse`
    - `created`: 新增 server 数量
    - `updated`: 更新 server 数量
    - `skipped`: 跳过数量

## 3. 同步规则说明

- 仅解析 `mcpServers` 字段（dict）
- `url` 存在时保存为 `server_type = sse`，否则保存为 `server_type = stdio`
- `command/args/env` 作为草稿配置入库（云端运行时只启用 SSE）
- `env` 仅保留键名列表，不保存明文值
