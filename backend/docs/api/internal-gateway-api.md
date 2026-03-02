# Internal Gateway API

> 内部通道 API 文档 - 面向内部前端和服务

---

## 概述

内部网关 (Internal Gateway) 提供面向内部系统的 AI 服务接口，适用于：
- 内部前端应用
- 内部服务调用
- 开发调试

**基础路径**: `/internal/v1`  
兼容路径: `/api/v1/internal`

**特点**:
- JWT Token 认证（无需签名）
- 跳过配额检查和计费
- 保留完整响应（无脱敏）
- 提供调试接口

---

## 认证

内部通道使用 **JWT Bearer Token** 认证：

```http
Authorization: Bearer <access_token>
```

### 获取 Token

参考 [认证文档](./authentication.md)：

```bash
# 登录获取 token
curl -X POST "https://gateway.example.com/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "your-password"}'
```

响应：
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

---

## API 端点

### 1. Chat Completions

创建对话补全请求。

**端点**: `POST /chat/completions`

#### 请求头

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

#### 请求体

```json
{
  "model": "gpt-4",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello!"}
  ],
  "stream": false,
  "status_stream": true,
  "temperature": 0.7,
  "max_tokens": 1000,
  "request_id": "optional-request-id",
  "provider_model_id": "7a0f2c3e-6b7d-4b9c-8a66-93c59f0a3c23",
  "assistant_id": "optional-assistant-id",
  "session_id": "optional-session-id"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 模型名称 |
| `messages` | array | 是 | 消息列表 |
| `messages[].role` | string | 是 | 角色：`system`/`user`/`assistant` |
| `messages[].content` | string/array | 是 | 消息内容 |
| `stream` | boolean | 否 | 是否流式返回，默认 `false` |

多模态内容示例（图片引用）：
```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "描述这张图片" },
    { "type": "image_url", "image_url": { "url": "asset://assets/demo/2026/01/15/hello.png" } }
  ]
}
```
说明：`asset://` 为对象存储 Key 的引用，网关会在上游调用前解析为短链签名 URL。
| `status_stream` | boolean | 否 | 是否通过 SSE 推送状态事件；为 `true` 时即使 `stream=false` 也会返回 SSE |
| `temperature` | float | 否 | 温度参数 (0-2) |
| `max_tokens` | integer | 否 | 最大生成 token 数 |
| `request_id` | string | 否 | 客户端请求 ID（用于取消/幂等） |
| `provider_model_id` | string | 是 | 指定 provider model ID（内部网关必填，禁用路由/负载均衡） |
| `assistant_id` | string | 否 | 助手 ID（用于会话归属） |
| `session_id` | string | 否 | 会话 ID（用于上下文管理） |

#### 响应体（非流式）

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 8,
    "total_tokens": 18
  },
  "session_id": "session-xyz"
}
```

#### 响应体（流式）

当 `stream=true` 时，返回 SSE (Server-Sent Events) 格式：

```
data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"}}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","choices":[{"delta":{"content":"!"}}]}

data: [DONE]
```

当 `status_stream=true` 时，SSE 会额外包含状态事件（示例）：

```
data: {"type":"status","stage":"listen","step":"validation","state":"running","code":"context.loaded","meta":{"count":3,"has_summary":false}}

data: {"type":"status","stage":"remember","step":"routing","state":"success","code":"routing.selected","meta":{"candidates":2,"provider":"openai"}}
```

当内部通道启用 blocks 事件时，SSE 会额外包含结构化块事件（示例）：

```
data: {"type":"blocks","blocks":[{"type":"thought","content":"我正在思考..."}]}

data: {"type":"blocks","blocks":[{"type":"text","content":"你好！我是谛听。"}]}
```

`blocks` 列表支持 `text` / `thought` / `tool_call` / `tool_result` / `ui` 类型，前端可直接渲染。  
其中 `ui` block 可包含 `viewType`、`payload`、`title`，用于图表/表格等结构化展示。  
当工具产出文件时，`ui` block 可使用 `viewType=generated.file`，常见 `payload` 字段如下：

```json
{
  "name": "report.md",
  "path": "/workspace/report.md",
  "size": 2451,
  "content_type": "text/markdown",
  "download_url": "https://gateway.example.com/api/v1/media/assets/...",
  "preview_kind": "markdown",
  "preview_text": "# Report\\n...",
  "truncated": false
}
```

`preview_kind` 可能为 `text` / `markdown` / `html` / `none`。当为 `none` 时前端仅展示下载入口。  
`tool_result` block 还可携带 `debug` 字段（如 `runtime_tool_calls`、`render_blocks`、`sdk_stub` 摘要），用于调试与回放展示。

若 `stream=false` 且 `status_stream=true`，会在状态事件之后返回一次完整结果：

```
data: {"id":"chatcmpl-abc123","object":"chat.completion","choices":[{"message":{"role":"assistant","content":"Hello!"}}],"session_id":"session-xyz"}

data: [DONE]
```

#### Code Mode 约束（Tool Calling）

当请求工具集中同时包含 `search_sdk` 和 `execute_code_plan` 时，Agent 会进入 Code Mode 严格模式：

- 默认允许模型直接调用：`search_sdk`、`execute_code_plan`、`consult_expert_network`、`search_knowledge`。
- 其余工具（系统工具、动态技能、用户 MCP 工具）直接调用会被拦截，返回 `CODE_MODE_DIRECT_TOOL_BLOCKED`。
- 推荐顺序：先 `search_sdk` 获取工具签名，再通过一次 `execute_code_plan` 在脚本内调用工具。
- 可通过环境变量 `CODE_MODE_DIRECT_TOOL_ALLOWLIST`（逗号分隔）调整额外放行名单。

---

### 1.1 Files Upload

将文件直接上传到上游模型文件接口（OpenAI-compatible `POST /files`）。

**端点**: `POST /files`  
**Content-Type**: `multipart/form-data`

#### 表单字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | file | 是 | 文件内容（如 `pdf/txt/docx`） |
| `purpose` | string | 否 | 上传用途，默认 `assistants` |
| `model` | string | 否 | 对外模型名（用于路由） |
| `provider_model_id` | string | 否 | 指定 provider model ID（优先于 `model`） |

说明：
- `model` 与 `provider_model_id` 至少提供一个。
- 若同时提供 `model` 与 `provider_model_id`，两者必须指向同一模型。
- 网关会按内部路由策略选择实例，并向上游 `.../files` 发起 multipart 请求。

#### 成功响应示例

```json
{
  "id": "file-abc123",
  "object": "file",
  "purpose": "assistants",
  "filename": "demo.pdf"
}
```

#### 常见错误

| HTTP | code | 说明 |
|------|------|------|
| 400 | `INVALID_REQUEST` | 缺少 `file`，或未传 `model/provider_model_id` |
| 404 | `MODEL_NOT_AVAILABLE` | 当前用户下无可用路由 |
| 502/504 | `UPSTREAM_ERROR`/`UPSTREAM_TIMEOUT` | 上游失败或超时 |

---

### 2. Sandbox Run

执行内部沙箱代码（OpenSandbox）。  
路径：`/api/v1/internal/sandbox/run`

请求：
```json
{
  "session_id": "session-001",
  "code": "print(1)",
  "language": "python"
}
```

响应：
```json
{
  "stdout": ["1\n"],
  "stderr": [],
  "result": [],
  "exit_code": 0,
  "error": null
}
```

说明：
- 实际会话隔离会自动加上 `user.id` 前缀。
- 仅支持 `python`。

---

### 3. Code Mode Bridge Call（Sandbox -> Host）

供沙箱内 `deeting.call_tool(...)` 回调宿主工具，使用 execution token 鉴权。  
路径：`/api/v1/internal/bridge/call`

请求头（二选一）：
```http
X-Code-Mode-Execution-Token: <execution_token>
Content-Type: application/json
```

请求体：
```json
{
  "tool_name": "fetch_web_content",
  "arguments": {
    "url": "https://example.com"
  },
  "execution_token": "optional-if-header-provided"
}
```

响应体：
```json
{
  "ok": true,
  "result": {
    "title": "Example",
    "url": "https://example.com"
  },
  "meta": {
    "call_index": 0,
    "max_calls": 8,
    "trace_id": "trace-001",
    "session_id": "sess-001"
  }
}
```

说明：
- `search_sdk` 与 `execute_code_plan` 在该接口上被禁止调用（防止递归）。
- execution token 有 TTL 和最大调用次数限制，超过上限返回 `429`。
- execution token 的 `allowed_models/scopes` 会在服务端做二次校验，不满足返回 `403`。
- 可通过配置开启来源 IP 白名单校验（`CODE_MODE_BRIDGE_ENFORCE_TRUSTED_IPS`）。
- 当 `skill__system.assistant_onboarding` 在同一 trace 内失败后，后续 `add_knowledge_chunk` 会被拒绝并返回 `409 CODE_MODE_ASSISTANT_ONBOARDING_FAILED`，用于避免模型在 onboarding 失败后擅自写入用户记忆。
- `ok` 字段按工具结果统一判定：只要工具结果包含失败状态（如 `status=failed/partial` 或 `error` 字段），`ok=false`。

---

### 4. Code Mode Executions（查询与回放）

用于查询历史代码执行记录，并在必要时按原参数或覆盖参数重放执行。  
路径：
- `GET /api/v1/internal/code-mode/executions/{execution_identifier}`
- `POST /api/v1/internal/code-mode/executions/{execution_identifier}/replay`

`execution_identifier` 支持两种值：
- 数据库主键 UUID（`id`）
- 运行时执行 ID（`execution_id`）

请求头：
```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

查询响应示例：
```json
{
  "id": "8ca1d2ce-4f8d-4ac7-9a37-6764f2e7b16c",
  "execution_id": "f8f68f2a4ba9488d8505ca5a67d3d2cb",
  "session_id": "sess-001",
  "language": "python",
  "status": "success",
  "runtime_context": {},
  "tool_plan_results": {},
  "runtime_tool_calls": {},
  "render_blocks": {},
  "duration_ms": 1240,
  "created_at": "2026-02-24T09:00:00+00:00"
}
```

回放请求示例：
```json
{
  "code": "print('replay')",
  "session_id": "sess-replay",
  "language": "python",
  "execution_timeout": 30,
  "dry_run": false,
  "tool_plan": [
    {
      "tool_name": "fetch_web_content",
      "arguments": {"url": "https://example.com"}
    }
  ]
}
```

回放响应示例：
```json
{
  "replay_of": "8ca1d2ce-4f8d-4ac7-9a37-6764f2e7b16c",
  "source_execution_id": "f8f68f2a4ba9488d8505ca5a67d3d2cb",
  "result": {
    "status": "success",
    "runtime": {"execution_id": "9f0c9e6d2bf542de9a6e70df4fd2a2e1"}
  }
}
```

说明：
- 仅允许当前登录用户访问自己的执行记录。
- 回放会复用历史 `runtime_context` 中的能力/权限线索，并可通过请求体覆盖 `code/tool_plan/session_id`。
- 回放本身也会写入新的执行记录。
- 若同一工作流上下文中存在最近一次 `search_sdk` 的工具快照，`execute_code_plan` 的 `tool_plan` 与运行时 `deeting.call_tool(...)` 仅允许调用该快照中的工具；否则会返回 `CODE_MODE_TOOL_PLAN_INVALID` 或 `CODE_MODE_RUNTIME_TOOL_CALL_INVALID`。快照为空时等价于“本轮不允许任何工具调用”。

---

### 5. Skill Execution

执行单个技能的端到端运行（克隆仓库、安装依赖、脚本拼接、执行并回传产物）。  
路径：`/api/v1/internal/skills/{skill_id}/execute`

请求：
```json
{
  "inputs": {
    "docx_path": "input.docx"
  },
  "intent": "edit",
  "session_id": "session-001"
}
```

响应：
```json
{
  "status": "ok",
  "stdout": ["ok\n"],
  "stderr": [],
  "exit_code": 0,
  "artifacts": [
    {
      "name": "output_docx",
      "type": "file",
      "path": "/workspace/skills/docx/output.docx",
      "size": 1024,
      "content_base64": "BASE64..."
    }
  ]
}
```

说明：
- `session_id` 为空时自动使用 `user.id` 作为会话隔离。
- `artifacts` 会包含 Base64 内容（后续可切换为对象存储引用）。

---

### 6. Skill Dry Run & Self‑Heal（内部流程）

当技能入库成功后，会自动触发一次 Dry Run，用于验证 Manifest 与产物契约是否一致。  
流程为**内部异步任务**，不提供外部 API 直接调用。

**触发时机**
- `skill_registry.ingest_repo` 任务完成后自动触发
- 通过 Celery 任务 `skill_registry.dry_run_skill` 执行（队列：`skill_registry`）

**状态流转**
- Dry Run 成功 → `active`
- Dry Run 失败 → `dry_run_fail`
- 连续失败达到阈值 → `needs_review`

**失败判定补充（2026-02-28）**
- 若运行时返回 `execution.error`（例如 `CommandExecError`），Dry Run 直接判定失败。
- 若运行日志 `stderr` 含 Python traceback 起始行（`Traceback (most recent call last):`），Dry Run 直接判定失败。

**失败自愈（Self‑Heal）**
- 每次失败都会触发自愈，**最多 N=2 次/技能**
- 自愈仅允许修改 Manifest 以下字段：
  - `usage_spec.example_code`
  - `installation.dependencies`
  - `env_requirements.system_packages`
  - `env_requirements.python_version`
- 自愈成功会重新 Dry Run（不会递归触发自愈）

**常见错误码**
- `exec_failed`：执行异常（运行时错误）
- `artifact_missing`：声明产物未生成
- `artifact_empty`：产物为空
- `unsafe_patch`：自愈补丁触及非白名单字段
- `error_code_mismatch`：补丁类型与错误码不匹配

**审计字段**
- `manifest_json.metrics.self_heal_history`：记录自愈次数与变更摘要

---

#### 取消对话流

**端点**: `POST /chat/completions/{request_id}/cancel`

用于中止正在进行的流式对话。仅对同一用户生效（最佳努力）。

响应示例：
```json
{
  "request_id": "req-20260123-abcdef",
  "status": "canceled"
}
```

---

### 2. Models

获取内部通道可用的模型列表（按 provider_instance 分组，包含公共实例 + 当前用户实例）。

**端点**: `GET /models`

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### Query 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `capability` | string | 否 | 能力过滤（如 `chat` / `image_generation` / `embedding` / `text_to_speech` / `speech_to_text` / `video_generation`）。服务端会做别名归一化：例如 `video` / `text_to_video` 视为 `video_generation`。 |

#### 响应体

```json
{
  "instances": [
    {
      "instance_id": "b8b8fdfd-8b6f-4f7d-8d3e-2b1c9c3c6e1a",
      "instance_name": "my-openai",
      "provider": "openai",
      "icon": "openai",
      "models": [
        {
          "id": "gpt-4o",
          "object": "model",
          "owned_by": "openai",
          "icon": "openai",
          "upstream_model_id": "gpt-4o",
          "provider_model_id": "7a0f2c3e-6b7d-4b9c-8a66-93c59f0a3c23"
        }
      ]
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `instances` | array | provider_instance 分组列表 |
| `instances[].instance_id` | string | 实例 ID |
| `instances[].instance_name` | string | 实例名称 |
| `instances[].provider` | string | 提供商标识 |
| `instances[].icon` | string | 提供商图标（可选） |
| `instances[].models[].id` | string | 模型 ID（可能为统一别名） |
| `instances[].models[].owned_by` | string | 提供商标识 |
| `instances[].models[].icon` | string | 提供商图标（可选） |
| `instances[].models[].upstream_model_id` | string | 上游模型 ID |
| `instances[].models[].provider_model_id` | string | provider model 唯一 ID（用于指定路由） |

---

### 3. Conversation Window

获取会话列表（内部通道，滚动加载）。

**端点**: `GET /conversations`

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### Query 参数

- `cursor`：游标（可空）
- `size`：单页数量（默认 20）
- `assistant_id`：助手 ID（仅返回该助手的会话）
- `status`：会话状态（默认 `active`，可选 `archived`/`closed`）

#### 响应体

```json
{
  "items": [
    {
      "session_id": "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d",
      "title": "API 调试",
      "summary_text": "用户在排查请求失败原因……",
      "message_count": 18,
      "first_message_at": "2026-01-16T09:20:11+08:00",
      "last_active_at": "2026-01-16T09:42:01+08:00"
    }
  ],
  "next_page": "cursor:...",
  "previous_page": null
}
```

**端点**: `POST /conversations`

创建一个新的会话记录（内部通道），用于前端“新建聊天”先占位拿到 `session_id`。

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### 请求体

```json
{
  "assistant_id": "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d",
  "title": "New Chat"
}
```

#### 响应体（201）

```json
{
  "session_id": "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d",
  "title": "New Chat"
}
```

**端点**: `GET /conversations/{session_id}`

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### 响应体

```json
{
  "session_id": "session-xyz",
  "messages": [
    {
      "role": "user",
      "content": "Hello",
      "turn_index": 1
    },
    {
      "role": "assistant",
      "content": "Hi!",
      "turn_index": 2,
      "meta_info": {
        "blocks": [
          { "type": "text", "content": "Hi!" }
        ]
      }
    }
  ],
  "meta": {
    "total_tokens": 128,
    "last_active_at": "2026-01-16T00:00:00Z"
  },
  "summary": {
    "content": "..."
  }
}
```

#### 请求示例

```python
import httpx

response = httpx.post(
    "https://gateway.example.com/internal/v1/chat/completions",
    json={
        "model": "gpt-4",
        "messages": [{"role": "user", "content": "Hello!"}]
    },
    headers={"Authorization": f"Bearer {access_token}"}
)
print(response.json())
```

**消息字段补充说明**：

- `messages[].meta_info`：可选，结构化元数据（如 `blocks` / `tool_calls` / 多模态内容）。
- `messages[].meta_info.blocks`：结构化块列表，支持 `text` / `thought` / `tool_call` / `tool_result` / `ui` 等类型，前端可直接按 block 渲染。
- `messages[].meta_info.blocks[].type == "tool_result"` 时，可能包含：
  - `ui`：工具返回的渲染块数组。
  - `debug`：Code Mode 运行时调试摘要（例如 `runtime_tool_calls`、`render_blocks`、`sdk_stub`）。
    - `runtime_tool_calls.calls[]` 可包含 `tool_name` / `status` / `duration_ms` / `error` / `error_code`，用于前端调试时间线。
    - 当 `execute_code_plan` 的 `exit_code=0` 但沙箱原始 `result` 为空时，系统会尝试从 `stdout` 最后一条结构化日志（优先 `[deeting.log]` JSON）回填 `result`，并记录 `code_mode_result_recovered` 调试日志。

---

### 4. Conversation History

历史消息分页加载（仅用于 UI 展示，不影响 Redis 滑动窗口上下文）。

**端点**: `GET /conversations/{session_id}/history`

#### Query 参数

- `cursor`：可选，向前翻页游标（turn_index），返回 `< cursor` 的更早消息。
- `limit`：可选，每页条数（默认 30，最大 200）。

#### 响应体

```json
{
  "session_id": "session-xyz",
  "messages": [
    {
      "role": "user",
      "content": "Hello",
      "turn_index": 8
    },
    {
      "role": "assistant",
      "content": "Hi!",
      "turn_index": 9
    }
  ],
  "next_cursor": 8,
  "has_more": true
}
```

**说明**：

- `messages` 按 `turn_index` 升序返回，便于前端直接拼接到顶部。
- `next_cursor` 用于下一次滚动加载（作为 `cursor` 传入）。

---

### 5. Conversation Archive

归档 / 取消归档会话（内部通道）。

**端点**: `POST /conversations/{session_id}/archive`

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### 响应体

```json
{
  "session_id": "session-xyz",
  "status": "archived"
}
```

**端点**: `POST /conversations/{session_id}/unarchive`

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### 响应体

```json
{
  "session_id": "session-xyz",
  "status": "active"
}
```

---

### 6. Conversation Rename

更新会话标题（内部通道）。

**端点**: `PATCH /conversations/{session_id}/title`

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### 请求体

```json
{
  "title": "新的会话标题"
}
```

#### 响应体

```json
{
  "session_id": "session-xyz",
  "title": "新的会话标题"
}
```

---

### 7. Conversation Assistant Lock

显式切换/解除会话的助手锁定（内部通道）。

**端点**: `PATCH /conversations/{session_id}/assistant`

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### 请求体

```json
{
  "assistant_id": "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d"
}
```

> 传 `null` 可解除锁定，恢复 JIT 自动路由。

#### 响应体

```json
{
  "session_id": "session-xyz",
  "assistant_id": "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d"
}
```

---

### 8. Conversation Feedback

记录会话反馈（内部通道），用于专家排序与探索。

**端点**: `POST /conversations/{session_id}/feedback`

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### 请求体

```json
{
  "event": "thumbs_up",
  "assistant_id": "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d",
  "turn_index": 12
}
```

> `assistant_id` 与 `turn_index` 至少传一个；若同时提供，优先使用 `assistant_id`。  
> `event` 支持：`thumbs_up` / `thumbs_down` / `regenerate`。

#### 响应体

```json
{
  "session_id": "session-xyz",
  "assistant_id": "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d",
  "event": "thumbs_up"
}
```

---

### 9. Assistant Routing Report

获取专家路由表现报表（内部通道）。

**端点**: `GET /assistants/routing/report`

#### 请求头

```http
Authorization: Bearer <access_token>
```

#### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `min_trials` | int | 否 | 最小试用次数 |
| `min_rating` | float | 否 | 最小评分（0-1） |
| `limit` | int | 否 | 返回条数上限（默认 50） |
| `sort` | string | 否 | 排序方式：`score_desc` / `rating_desc` / `trials_desc` / `recent_desc` |

#### 响应体

```json
{
  "summary": {
    "total_assistants": 2,
    "total_trials": 24,
    "total_positive": 16,
    "total_negative": 8,
    "overall_rating": 0.7
  },
  "items": [
    {
      "assistant_id": "2b0f6a7a-8c0e-4c35-9a63-7a2d0a4b3b9d",
      "name": "Expert A",
      "summary": "summary",
      "total_trials": 12,
      "positive_feedback": 9,
      "negative_feedback": 3,
      "rating_score": 0.75,
      "mab_score": 0.75,
      "routing_score": 0.69,
      "exploration_bonus": 0.0,
      "last_used_at": "2026-01-16T09:42:01+08:00",
      "last_feedback_at": "2026-01-16T09:45:01+08:00"
    }
  ]
}
```

---

### 2. Embeddings

创建文本嵌入向量。

**端点**: `POST /embeddings`

#### 请求体

```json
{
  "model": "text-embedding-ada-002",
  "input": "The food was delicious and the waiter...",
  "provider_model_id": "7a0f2c3e-6b7d-4b9c-8a66-93c59f0a3c23"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 嵌入模型名称 |
| `input` | string/array | 是 | 输入文本或文本数组 |
| `provider_model_id` | string | 是 | 指定 provider model ID（内部网关必填，禁用路由/负载均衡） |

#### 响应体

```json
{
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.0023, -0.0096, 0.0015, ...]
    }
  ],
  "model": "text-embedding-ada-002",
  "usage": {
    "prompt_tokens": 8,
    "total_tokens": 8
  }
}
```

---

### 3. List Models

获取可用模型列表（同上 `/models` 接口，需鉴权）。

**端点**: `GET /models`

#### 响应体

---

### 4. Debug: Test Routing

测试路由决策，不实际调用上游。

**端点**: `POST /debug/test-routing`

#### 请求体

```json
{
  "model": "gpt-4",
  "capability": "chat",
  "request_id": "debug-req-001",
  "provider_model_id": "3a5e9c7f-2f18-4d3c-9e87-15b1c6b3f2a1"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 模型名称 |
| `capability` | string | 否 | 能力类型，默认 `chat`（支持 `image_generation` / `text_to_speech` / `speech_to_text` / `video_generation` 等） |
| `request_id` | string | 否 | 客户端请求 ID（用于取消/幂等） |
| `provider_model_id` | string | 是 | 指定 provider model ID（内部网关必填，禁用路由/负载均衡） |

#### 响应体

```json
{
  "model": "gpt-4",
  "capability": "chat",
  "provider": "openai",
  "preset_id": 1,
  "preset_item_id": 2,
  "instance_id": "b8b8fdfd-8b6f-4f7d-8d3e-2b1c9c3c6e1a",
  "provider_model_id": "3a5e9c7f-2f18-4d3c-9e87-15b1c6b3f2a1",
  "upstream_url": "https://api.openai.com",
  "template_engine": "simple_replace",
  "routing_config": {},
  "limit_config": {},
  "pricing_config": {},
  "affinity_hit": false
}
```

#### 错误响应

当无可用上游或路由失败时，返回 `GatewayError`。

---

### 5. Debug: Step Registry

查看已注册的编排步骤。

**端点**: `GET /debug/step-registry`

#### 响应体

```json
{
  "steps": [
    "validation",
    "routing",
    "upstream_call"
  ]
}
```

```json
{
  "data": [
    {"id": "gpt-4", "object": "model", "owned_by": "gateway"},
    {"id": "gpt-3.5-turbo", "object": "model", "owned_by": "gateway"},
    {"id": "claude-3-opus", "object": "model", "owned_by": "gateway"}
  ]
}
```

> **注意**: 内部通道显示所有已配置的模型，不受权限过滤。

---

### 4. Bandit Report (内部专属)

获取路由 Bandit 算法的观测报表。

**端点**: `GET /bandit/report`

#### 查询参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `capability` | string | 能力过滤（如 `chat` / `image_generation` / `text_to_speech` / `speech_to_text` / `video_generation`） |
| `model` | string | 模型过滤 |

#### 响应体

```json
{
  "summary": {
    "total_arms": 5,
    "total_trials": 10000,
    "overall_success_rate": 0.95
  },
  "items": [
    {
      "arm_id": "provider-openai-gpt4",
      "capability": "chat",
      "model": "gpt-4",
      "total_trials": 5000,
      "successes": 4800,
      "success_rate": 0.96,
      "avg_latency_ms": 1200,
      "last_selected_at": "2026-01-06T10:30:00Z"
    }
  ]
}
```

---

## Bridge API (内部专属)

Bridge API 用于与云端 Tunnel Gateway 交互，管理 Agent 和工具调用。

**基础路径**: `/internal/v1/bridge`

### 1. 列出 Agents

**端点**: `GET /bridge/agents`

```json
{
  "agents": [
    {"id": "agent-001", "name": "Code Assistant", "status": "online"},
    {"id": "agent-002", "name": "Data Analyst", "status": "offline"}
  ]
}
```

### 2. 列出 Agent 工具

**端点**: `GET /bridge/agents/{agent_id}/tools`

```json
{
  "tools": [
    {"name": "execute_code", "description": "Execute Python code"},
    {"name": "query_database", "description": "Query SQL database"}
  ]
}
```

### 3. 签发 Agent Token

**端点**: `POST /bridge/agent-token`

#### 请求体

```json
{
  "agent_id": "agent-001",
  "reset": false
}
```

#### 响应体

```json
{
  "agent_id": "agent-001",
  "token": "bat_xxxxxxxxxxxxxxxxxx",
  "expires_at": "2026-01-07T10:30:00Z",
  "version": 3,
  "reset": false
}
```

### 4. 调用工具

**端点**: `POST /bridge/invoke`

#### 请求体

```json
{
  "req_id": "req-12345",
  "agent_id": "agent-001",
  "tool_name": "execute_code",
  "arguments": {
    "code": "print('Hello, World!')"
  },
  "timeout_ms": 60000,
  "stream": true
}
```

### 5. 取消调用

**端点**: `POST /bridge/cancel`

#### 请求体

```json
{
  "req_id": "req-12345",
  "agent_id": "agent-001",
  "reason": "user_cancel"
}
```

### 6. 事件流

**端点**: `GET /bridge/events`

返回 SSE 事件流，用于实时监听 Agent 状态和工具执行结果。

---

## 错误响应

### 错误格式

```json
{
  "code": "ERROR_CODE",
  "message": "Human readable error message",
  "source": "gateway|upstream|client",
  "trace_id": "req-abc123",
  "upstream_status": 500,
  "upstream_code": "model_overloaded"
}
```

### HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| `400` | Bad Request - 请求格式错误 |
| `401` | Unauthorized - Token 无效或过期 |
| `403` | Forbidden - 权限不足 |
| `502` | Bad Gateway - 上游服务错误 |
| `503` | Service Unavailable - 服务不可用 |
| `504` | Gateway Timeout - 上游超时 |

---

## 与外部通道的区别

| 特性 | 内部通道 | 外部通道 |
|------|----------|----------|
| 认证方式 | JWT Token | HMAC 签名 |
| 配额检查 | 跳过 | 启用 |
| 限流 | 宽松 (600 RPM) | 严格 (60 RPM) |
| 计费 | 仅记录用量 | 实际扣费 |
| 响应脱敏 | 不脱敏 | 脱敏处理 |
| 调试接口 | 可用 | 不可用 |
| 适用场景 | 内部系统 | 第三方客户 |

---

## 最佳实践

### 1. Token 刷新

```python
import httpx
from datetime import datetime, timedelta

class GatewayClient:
    def __init__(self):
        self.access_token = None
        self.refresh_token = None
        self.expires_at = None

    async def ensure_token(self):
        if self.expires_at and datetime.utcnow() < self.expires_at - timedelta(minutes=5):
            return

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{base_url}/api/v1/auth/refresh",
                json={"refresh_token": self.refresh_token}
            )
            data = response.json()
            self.access_token = data["access_token"]
            self.refresh_token = data["refresh_token"]
            self.expires_at = datetime.utcnow() + timedelta(seconds=data["expires_in"])

    async def chat(self, messages):
        await self.ensure_token()
        async with httpx.AsyncClient() as client:
            return await client.post(
                f"{base_url}/internal/v1/chat/completions",
                json={"model": "gpt-4", "messages": messages},
                headers={"Authorization": f"Bearer {self.access_token}"}
            )
```

### 2. 流式处理

```python
async def stream_chat(messages: list):
    async with httpx.AsyncClient() as client:
        async with client.stream(
            "POST",
            f"{base_url}/internal/v1/chat/completions",
            json={"model": "gpt-4", "messages": messages, "stream": True},
            headers={"Authorization": f"Bearer {access_token}"},
        ) as response:
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    content = chunk["choices"][0]["delta"].get("content", "")
                    print(content, end="", flush=True)
```

### 3. 错误处理

```python
async def call_with_retry(messages: list, max_retries: int = 3):
    for attempt in range(max_retries):
        try:
            response = await chat(messages)
            if response.status_code == 401:
                # Token 过期，刷新后重试
                await refresh_tokens()
                continue
            if response.status_code == 503:
                # 服务不可用，指数退避
                await asyncio.sleep(2 ** attempt)
                continue
            return response.json()
        except httpx.TimeoutException:
            if attempt == max_retries - 1:
                raise
            await asyncio.sleep(1)
    raise Exception("Max retries exceeded")
```

---

## 更新日志

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0.0 | 2026-01-06 | 初始版本 |

---

*最后更新: 2026-01-06*
