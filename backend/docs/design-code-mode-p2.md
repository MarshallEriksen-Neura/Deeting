# P2: 完整 Code Mode 实现规划

## 概述
P2 阶段目标：从 function-calling 主导切到"代码计划执行"主导，实现完整的 Code Mode 功能。

## P2.1: 运行时协议

### 目标
定义 Code Mode 运行时通信协议，确保前后端、宿主与沙箱之间的交互一致性。

### 具体任务

#### P2.1.1: 协议版本管理
- [x] 在 `DeetingCoreSdkPlugin` 中添加 `format_version` 字段 (当前已有 sdk_toolcard.v2)
- [x] 创建 `runtime_protocol_version` 常量，统一版本号格式 (如 `v1`)

#### P2.1.2: 请求/响应协议标准化
- [x] 标准化 `execute_code_plan` 请求格式:
  ```python
  {
    "code": str,           # Python 代码
    "session_id": str,     # 会话 ID
    "language": str,        # python
    "execution_timeout": int,
    "dry_run": bool,
    "tool_plan": [
      {
        "tool_name": str,
        "arguments": dict,
        "save_as": str,
        "on_error": "stop" | "continue"
      }
    ]
  }
  ```
- [x] 标准化响应格式:
  ```python
  {
    "status": "success" | "failed" | "dry_run",
    "runtime": {
      "execution_id": str,
      "session_id": str,
      "user_id": str,
      "started_at": str,
      "duration_ms": int,
      "sdk_stub": {...},
      "tool_plan": {...},
      "runtime_tool_calls": {...},
      "render_blocks": {...}
    },
    "result": Any,
    "error": str,
    "error_code": str
  }
  ```

#### P2.1.3: 内联协议 (Sandbox <-> Host)
- [x] 定义 marker 协议常量统一管理:
  - `_RUNTIME_TOOL_CALL_MARKER`
  - `_RUNTIME_RENDER_BLOCK_MARKER`
- [x] 创建协议解析器模块 `app/services/code_mode/protocol.py`

## P2.2: 可观测性

### 目标
实现完整的运行时可观测性，支持调试、性能分析和问题诊断。

### 具体任务

#### P2.2.1: Tracing
- [x] 在 `execute_code_plan` 中添加 OpenTracing 兼容的 tracing:
  - 创建 `app/services/code_mode/tracing.py`
  - 添加 span: `code_mode.execution`, `code_mode.tool_plan`, `code_mode.sandbox.run`
- [x] 在 `runtime_context` 中传递 `trace_id`

#### P2.2.2: Metrics
- [x] 添加 Prometheus 指标:
  - `code_mode_executions_total` (counter)
  - `code_mode_execution_duration_seconds` (histogram)
  - `code_mode_tool_calls_total` (counter)
  - `code_mode_errors_total` (counter)
- [x] 在 `app/core/metrics.py` 中添加 Code Mode 指标

#### P2.2.3: Logging
- [x] 标准化日志字段:
  - `trace_id`, `session_id`, `user_id`, `execution_id`
  - `code_chars`, `tool_plan_steps`, `runtime_tool_calls`
- [x] 添加结构化日志到关键路径

## P2.3: 回放与审计

### 目标
实现 Code Mode 执行回放和审计功能，支持合规和问题排查。

### 具体任务

#### P2.3.1: 执行记录存储
- [x] 创建 `app/models/code_mode_execution.py` 模型:
  ```python
  class CodeModeExecution:
      id: UUID
      user_id: UUID
      session_id: str
      code: str
      status: str
      runtime_context: JSON
      tool_plan_results: JSON
      runtime_tool_calls: JSON
      render_blocks: JSON
      error: str
      duration_ms: int
      created_at: datetime
  ```
- [x] 创建 `app/repositories/code_mode_execution_repository.py`

#### P2.3.2: 审计日志
- [x] 在 `bridge.py` 中添加审计日志记录:
  - `trace_id`, `session_id`, `user_id`
  - `tool_name`, `arguments` (脱敏)
  - `status`, `duration_ms`, `error`
- [x] 创建 `app/services/code_mode/audit_service.py`

#### P2.3.3: 回放 API
- [x] 创建 `GET /api/v1/internal/code-mode/executions/{id}` 接口
- [x] 支持回放参数调整后重新执行

## P2.4: 文档体系

### 目标
建立完整的 Code Mode 文档，方便开发者理解和使用。

### 具体任务

#### P2.4.1: API 文档
- [x] 更新 `docs/api/` 中的 Code Mode 相关 API 文档
- [ ] 添加 OpenAPI schema 到 `execute_code_plan` 端点

#### P2.4.2: 开发者文档
- [ ] 创建 `docs/code-mode/getting-started.md`
- [ ] 创建 `docs/code-mode/sdk-reference.md`
- [ ] 创建 `docs/code-mode/examples.md`

#### P2.4.3: 错误码文档
- [x] 整理所有 `CODE_MODE_*` 错误码
- [ ] 创建 `docs/code-mode/error-codes.md`

## 文件清单

| 模块 | 文件 | 状态 |
|------|------|------|
| Protocol | `app/services/code_mode/__init__.py` | TODO |
| Protocol | `app/services/code_mode/protocol.py` | TODO |
| Tracing | `app/services/code_mode/tracing.py` | TODO |
| Metrics | `app/core/metrics.py` (扩展) | TODO |
| Audit | `app/services/code_mode/audit_service.py` | DONE |
| Model | `app/models/code_mode_execution.py` | DONE |
| Repository | `app/repositories/code_mode_execution_repository.py` | DONE |
| API | `app/api/v1/internal/code_mode_routes.py` | DONE |
| Docs | `docs/code-mode/` | TODO |

## 依赖关系

```
P2.1 (Protocol) 
    ↓
P2.2 (Observability) ← P2.1
    ↓
P2.3 (Audit) ← P2.1, P2.2
    ↓
P2.4 (Docs)
```

## 实施顺序

1. **Week 1**: P2.1 运行时协议标准化
2. **Week 2**: P2.2 可观测性 (Metrics + Logging)
3. **Week 3**: P2.3 回放与审计
4. **Week 4**: P2.4 文档 + 集成测试

## 风险与缓解

| 风险 | 缓解方案 |
|------|----------|
| 存储开销大 | 使用冷热分离，30天后归档 |
| 性能影响 | 异步写入审计日志 |
| 协议变更 | 版本号控制，优雅降级 |
