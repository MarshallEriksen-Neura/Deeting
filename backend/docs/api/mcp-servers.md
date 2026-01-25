# MCP 服务器与运行态 API（云端）

用于 Web 端管理远程 MCP 服务器、工具启用状态以及测试调用。

## 1. 服务器管理

- `GET /mcp/servers`
  - 说明：列出当前用户的 MCP 服务器
  - 响应：`UserMcpServerResponse[]`
  - 响应字段补充：
    - `source_id`: 订阅来源 ID（可空）
    - `source_key`: 订阅来源内的 server key（可空）

- `POST /mcp/servers`
  - 说明：新增 MCP 服务器
  - 请求体（示例）：
    - `name`: 服务器名称
    - `description`: 描述（可选）
    - `server_type`: `sse` | `stdio`（默认 `sse`）
    - `sse_url`: 远程 MCP SSE 地址（`server_type=sse` 必填）
    - `auth_type`: `bearer` | `api_key` | `none`
    - `secret_value`: 密钥（可选，写入后端 SecretManager）
    - `is_enabled`: 是否启用（`stdio` 类型会强制为 false）
    - `draft_config`: 草稿配置（仅 `stdio`，仅保存安全字段）
  - 响应：`UserMcpServerResponse`

- `PUT /mcp/servers/{server_id}`
  - 说明：更新 MCP 服务器配置（可切换 `server_type`）
  - 响应：`UserMcpServerResponse`

- `POST /mcp/servers/{server_id}/sync`
  - 说明：手动同步远程工具（仅 `server_type=sse`）
  - 响应：`UserMcpServerResponse`

- `DELETE /mcp/servers/{server_id}`
  - 说明：删除 MCP 服务器
  - 响应：`{ "ok": true }`

## 2. 工具列表与启用开关

- `GET /mcp/servers/{server_id}/tools`
  - 说明：返回该服务器缓存的工具列表
  - 响应：`McpServerToolItem[]`

- `PATCH /mcp/servers/{server_id}/tools/{tool_name}`
  - 说明：启用/禁用指定工具
  - 请求体：
    - `enabled`: boolean
  - 响应：`McpServerToolItem`

## 3. 工具测试

- `POST /mcp/tools/test`
  - 说明：对指定工具进行一次同步测试调用
  - 请求体：
    - `server_id`: 服务器 ID
    - `tool_name`: 工具名称
    - `arguments`: 参数对象
  - 响应：`McpToolTestResponse`
    - `status`: `success` | `error`
    - `result`: 成功返回的工具结果（可为任意 JSON）
    - `error`: 失败信息（可选）
    - `logs`: 轻量日志（字符串数组）
    - `trace_id`: 流水 ID（便于后续日志追踪）
