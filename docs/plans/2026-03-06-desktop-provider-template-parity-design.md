# Desktop Provider Template Parity Design

Date: 2026-03-06

> 状态：核心能力已落地，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- 桌面端已同步更完整的 preset 字段，并具备接近云端的 provider request preparation/runtime。
- `template_engine`、`response_transform`、`auth_type`、`default_headers`、`default_params`、`capability_configs` 等关键配置已进入桌面端本地存储与运行时。
- 本文件不再维护详细设计过程，后续以桌面 provider runtime 与同步链路为准。

## 当前实现入口
- 桌面请求准备：`deeting/src-tauri/src/modules/providers/request_runtime.rs`
- 桌面响应转换：`deeting/src-tauri/src/modules/providers/response_transformer.rs`
- 本地 preset 存储：`deeting/src-tauri/src/modules/providers/store/presets.rs`
- 本地 schema/migration：`deeting/src-tauri/src/modules/providers/store/mod.rs`
- 桌面平台适配：`deeting/lib/platform/adapters/desktop/provider-service.ts`
- 桌面对话接入：`deeting/src-tauri/src/modules/mcp/commands_parts/runtime_and_routing.rs`
- 回归测试：`deeting/src-tauri/src/modules/providers/request_runtime.rs`

## 维护说明
- 若继续追求与云端 provider pipeline 的完全一致，请围绕桌面 request runtime 和 preset sync 开新方案。
- 本文件仅保留落地状态说明。
