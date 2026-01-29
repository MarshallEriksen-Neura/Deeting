# 内部通道思维链 Blocks 统一输出设计

## 背景与目标
- 现状：前端只识别 `message.blocks` 或 `content` 中的 `<think>...</think>`，上游返回的 reasoning 字段不会被展示。
- 目标：**仅内部通道**实现流式/非流式统一输出 `blocks`，前端可稳定展示“思维链”。
- 约束：外部通道保持 OpenAI 兼容，不注入新事件。

## 方案概览
采用 **统一 blocks 事件（SSE）+ 非流式 blocks 回填**：
- 流式：新增 SSE 事件 `type: "blocks"`，`blocks` 为标准化结构（text / thought / tool_call）。
- 非流式：在 `response_transform` 之后生成 `meta_info.blocks` 与 `reasoning_content`。
- 前端仅消费 `blocks`（或回落 `<think>`），不再感知厂商字段。

## 事件协议（内部）
```json
data: {
  "type": "blocks",
  "blocks": [
    { "type": "thought", "content": "我正在思考..." },
    { "type": "text", "content": "你好！我是谛听。" }
  ],
  "trace_id": "...",
  "timestamp": "2026-01-29T12:00:00Z"
}
```

## 模板映射规则
在 `provider_preset.capability_configs.*` 中新增可选规则（示意）：
- `reasoning_extraction`: reasoning 字段抽取路径（JSONPath/KeyPath）
- `content_extraction`: content 字段抽取路径（JSONPath/KeyPath）
- `tool_extraction`: tool_call 抽取路径（JSONPath/KeyPath）

非流式：`response_transform` 完成后按规则生成 `message.reasoning_content` 与 `meta_info.blocks`。  
流式：在 SSE `delta` 中按同一规则抽取 `*_delta` 并实时 emit `blocks` 事件。

## 实现切入点
1) **流式解析与事件**  
`backend/app/services/workflow/steps/upstream_call.py`  
- 解析 SSE `data` JSON，抽取 reasoning/content/tool_calls。  
- 生成标准 `blocks`，通过 `ctx.status_emitter` 推送 `type:"blocks"`。  
- 仅内部通道且 `status_stream=true` 时启用。

2) **非流式回填**  
`backend/app/services/workflow/steps/response_transform.py`  
- 在 transform 之后构建 `meta_info.blocks`。  
- 保留 `content` 与 `reasoning_content` 分离。

3) **落库/回放**  
`backend/app/services/workflow/steps/conversation_append.py`  
- 若 `meta_info.blocks` 已存在则直接保存，避免 `<think>` 二次解析。

## 错误处理与兼容性
- 模板字段缺失或解析失败：跳过 blocks，不影响原始响应。
- blocks 事件不参与计费，仅用于 UI。
- 仅 internal + status_stream 输出 blocks，外部接口保持兼容。

## 测试计划
- 单测：SSE delta -> blocks（thought/text/tool_call）。
- 单测：非流式响应 -> `meta_info.blocks`。
- 集成：内部流式聊天响应包含 blocks 事件；外部接口无新增事件。

## 文档更新
- 在 `docs/api` 增补内部 SSE `type:"blocks"` 事件说明与示例。

## 后续步骤
- 确认模板字段命名与抽取方式（JSONPath or KeyPath）。  
- 实现流式 transformer + 非流式 blocks 构建。  
- 前端仅消费 `blocks`（如需，可保留 `<think>` 作为兜底）。
