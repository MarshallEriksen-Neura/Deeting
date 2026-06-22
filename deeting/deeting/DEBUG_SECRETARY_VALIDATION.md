# Secretary Validation 循环问题调试指南

## 问题描述
系统在 `world_model.frame_validation` 阶段陷入无限循环：
- `frame_refresh.updated` → `frame_validation.request` → `frame_validation.failed` → 循环

## 已修复内容

### 1. 添加详细日志 ✅
现在会记录：
- 模型返回的完整响应 (debug level)
- 解析失败的详细错误 (warn/error level)
- 前端状态事件中包含 response_preview

### 2. 添加循环熔断 ✅
当 `secretary_parse_failed` 或 `secretary_call_failed` 时：
- `local_prior_validation` 返回 `is_valid: false`
- 框架刷新循环停止，不会无限重试

## 如何查看日志

### 方法 1: 运行时查看控制台日志

启动应用时设置日志级别：

**Windows (PowerShell):**
```powershell
$env:RUST_LOG="debug"
npm run tauri dev
```

**Windows (CMD):**
```cmd
set RUST_LOG=debug
npm run tauri dev
```

**Mac/Linux:**
```bash
RUST_LOG=debug npm run tauri dev
```

### 方法 2: 查看前端状态事件

在浏览器开发者工具中查看 SSE 事件：

1. 打开开发者工具 (F12)
2. 找到 Network 标签页
3. 过滤 EventSource 或 SSE 连接
4. 查看包含 `response_preview` 字段的 `world_model.frame_validation.failed` 事件

示例事件：
```json
{
  "type": "status",
  "code": "world_model.frame_validation.failed",
  "state": "failed",
  "meta": {
    "frame_id": "...",
    "model_role": "secretary",
    "error_code": "SECRETARY_PARSE_FAILED",
    "error_kind": "structured_response_parse_failed",
    "response_preview": "{...前500字符...}"
  }
}
```

## 要查找的日志

### 关键日志 1: 原始响应
```
[DEBUG] Secretary validation raw response: {
  "tool_calls": [...],
  "content": "...",
  ...
}
```

### 关键日志 2: 解析失败详情
```
[WARN] Failed to parse SecretaryValidationDecision: missing field `contradiction_signal`
Response structure: {
  "is_valid": true,
  "reason": "..."
}
```

### 关键日志 3: 循环熔断
```
[WARN] local_prior_validation rejecting frame due to secretary tool failure: secretary_parse_failed
```

## 常见问题与解决方案

### 问题 1: SECRETARY_PARSE_FAILED
**原因**: 模型调用了工具，但返回的 JSON 结构不符合 `SecretaryValidationDecision`

**可能的错误**:
1. **字段名错误**: `isValid` 而非 `is_valid`
2. **字段缺失**: 缺少 `contradiction_signal`
3. **类型错误**: `is_valid: "true"` (字符串) 而非布尔值
4. **枚举值错误**: `"None"` 而非 `"none"`

**解决方案**: 从日志中查看实际返回的 JSON，调整：
- 提示词 (让模型返回正确格式)
- 或解析逻辑 (增加容错)

### 问题 2: SECRETARY_CALL_FAILED
**原因**: 模型根本没有调用 `submit_frame_validation` 工具

**可能的错误**:
1. 模型忽略了工具调用指令
2. `tool_calls` 数组为空
3. 调用了错误的工具名

**解决方案**:
- 检查提示词是否明确 (L48: "必须调用 submit_frame_validation 工具一次")
- 检查模型是否支持强制工具调用
- 从日志查看是否有 `tool_calls` 字段

## 预期的正确响应格式

模型应该返回：
```json
{
  "tool_calls": [
    {
      "id": "call_xxx",
      "name": "submit_frame_validation",
      "arguments": {
        "is_valid": true,
        "reason": "frame 仍然新鲜、与目标一致",
        "contradiction_signal": "none"
      }
    }
  ],
  "content": ""
}
```

其中 `arguments` 会被解析为 `SecretaryValidationDecision`:
```rust
struct SecretaryValidationDecision {
    is_valid: bool,
    reason: String,
    contradiction_signal: SecretaryContradictionSignal,  // "none" | "stale_facts" | "goal_drift" | "missing_assumption"
}
```

## 下一步

1. **重现问题**: 使用触发循环的相同输入
2. **收集日志**: 按上述方法启用 debug 日志
3. **分析响应**: 查看模型实际返回了什么
4. **提供反馈**: 将日志中的 response 结构反馈给开发团队

## 相关文件

- 验证逻辑: `src-tauri/src/modules/desktop_runtime/runtime/execution_plane/composition/components/runtime_components.rs:L394-L629`
- 提示词模板: `TIER2_VALIDATION_PROMPT_TEMPLATE_ZH` (L43-80)
- 工具 Schema: `tier2_validation_tool_schema()` (L605-617)
