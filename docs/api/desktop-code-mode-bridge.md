# Desktop Code Mode Bridge API

更新时间：2026-03-03

## 范围
- 文档描述桌面端（Tauri）Code Mode 本地执行与本地执行记录同步能力。
- 本地运行时桥接仅监听 `127.0.0.1` 回环地址。

## 协议常量
- `runtime_protocol_version`: `v1`
- `format_version`: `code_mode.v1`
- Tool Call Marker: `__DEETING_TOOL_CALL_REQUEST__`
- Render Block Marker: `__DEETING_RENDER_BLOCK__`
- Execution Token Header: `X-Code-Mode-Execution-Token`

## 本地 Bridge 端点
执行 `execute_local_code_mode` 时自动拉起本地 bridge（随机端口）：
- `POST /context`
- `POST /call`
- `POST /file/write`
- `POST /file/read`

统一返回：
- 成功：`{ "ok": true, ... }`
- 失败：`{ "ok": false, "error_code": "...", "error": "..." }`

## Tauri Commands
- `get_local_code_mode_bridge_status`
- `execute_local_code_mode`
- `list_local_code_mode_executions`
- `get_local_code_mode_execution`
- `replay_local_code_mode_execution`
- `sync_local_code_mode_executions`（新增）

## sync_local_code_mode_executions
用于把桌面本地 `code_mode_executions` 中未同步记录批量推送到云端 `POST /api/v1/internal/code-mode/executions/sync`。

默认行为（当前）：
- 用户维度上云同步默认关闭。
- 仅当桌面端环境变量 `DESKTOP_ALLOW_USER_CLOUD_SYNC=true` 时，该命令才会实际推送。
- 未开启时，命令返回空结果（`synced/exists/failed` 均为 `0`）。

请求参数：
- `accessToken: string`（必填，云端 Bearer Token）
- `limit?: number`（可选，默认 50，最大 200）

返回结构：
```json
{
  "results": [
    {
      "execution_id": "local_exec_xxx",
      "status": "synced | exists | failed",
      "id": "cloud_record_id | null",
      "error": "error_message | null"
    }
  ],
  "summary": {
    "synced": 0,
    "exists": 0,
    "failed": 0
  }
}
```

## 本地执行记录（SQLite）
表：`code_mode_executions`

新增同步相关列：
- `code`
- `sync_status`（`pending | synced | failed`）
- `sync_attempts`
- `last_sync_error`
- `last_synced_at`
- `cloud_id`

迁移行为：
- 已存在记录会尝试从 `runtime_context_json.code` 回填 `code`。
- `sync_status` 为空时会回填为 `pending`。

## 同步状态语义
- `synced` / `exists`：本地记录标记为 `synced`，并更新 `last_synced_at`。
- `failed`：本地记录标记为 `failed`，累加 `sync_attempts`，记录 `last_sync_error`。

## 对话自动触发与动态扫描
- 在桌面对话路径中，当模型返回 OpenAI 兼容 `tool_calls` 且工具名为 `search_sdk` / `execute_code_plan` 时，会自动进入本地 Code Mode 执行。
- 自动编排支持最多 30 轮循环（模型发起 tool_calls -> 执行 -> 回注结果 -> 模型继续），超过上限会停止并返回当前可用结果。
- `search_sdk` 返回采用动态扫描：实时读取本地 MCP 工具（名称、描述、状态、capabilities、可推断参数签名）与本地 bridge 核心工具，减少签名过期导致的调用失败。
