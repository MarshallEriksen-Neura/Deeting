# MCP 市场与订阅 API（云端 Inventory）

- 前置条件：需要登录（Bearer Token），路由前缀 `/api/v1`。
- 说明：云端只保存“订阅清单与安装说明书（manifest）”，不保存本地运行参数/密钥。

## 市场工具列表

- `GET /mcp/market-tools`
- Query：
  - `category`：分类过滤（developer/productivity/search/data/other）
  - `q`：搜索关键字（匹配 name/description/identifier）
- 响应：`McpMarketToolSummary[]`

## 市场工具详情

- `GET /mcp/market-tools/{tool_id}`
- 响应：`McpMarketToolDetail`
- 说明：包含 `install_manifest`，供本地实例化时生成表单与命令。

## 我的订阅清单

- `GET /mcp/subscriptions`
- 响应：`McpSubscriptionItem[]`
- 说明：每条订阅包含 `tool` 的展示信息。

## 订阅工具

- `POST /mcp/subscriptions`
- Body：
  ```json
  {
    "tool_id": "uuid",
    "alias": "optional alias"
  }
  ```
- 响应：`McpSubscriptionItem`
- 说明：若已订阅则返回已有记录（HTTP 200）；首次订阅返回 201。

## 取消订阅

- `DELETE /mcp/subscriptions/{tool_id}`
- 响应：`MessageResponse`

---

## Install Manifest 结构

`install_manifest` 是一个轻量 JSON，结构如下：

```json
{
  "runtime": "node|python|docker|binary",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-brave-search"],
  "env_config": [
    {
      "key": "BRAVE_API_KEY",
      "label": "Brave API Key",
      "required": true,
      "secret": true,
      "description": "Get it from https://api.search.brave.com/app/keys",
      "default": null
    }
  ]
}
```

- `env_config` 用于本地 UI 生成配置表单，云端不存任何密钥。

---

变更记录
- 2026-01-16：新增 MCP 市场与订阅 API（云端 Inventory）。
