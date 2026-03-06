# Provider Preset 重构设计（BYOP 通道模式）

> 状态：核心架构已落地，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- Provider preset / instance / model 的分层设计已经进入现行实现，并成为 BYOP 与平台通道的基础结构。
- 本文中的若干后续项（如更完整的自动探测与报表适配）仍可继续演进，但不再影响当前主链路。

## 当前实现入口
- Preset 管理路由：`backend/app/api/v1/admin/provider_preset_route.py`
- Instance 管理路由：`backend/app/api/v1/admin/provider_instance_route.py`
- Preset schema：`backend/app/schemas/provider_preset.py`
- Preset 模型：`backend/app/models/provider_preset.py`
- Instance / Model 模型：`backend/app/models/provider_instance.py`
- Provider API 文档：`docs/api/providers.md`
- Provider Instance API 文档：`docs/api/provider_instance.md`
- 桌面端本地 preset 存储：`deeting/src-tauri/src/modules/providers/store/presets.rs`
- 桌面端 provider 适配：`deeting/lib/platform/adapters/desktop/provider-service.ts`

## 维护说明
- 如需继续推进自动探测、Bandit 报表适配或更复杂的 preset 演进，请围绕现有 provider preset / instance / model 边界重新开新方案。
- 本文件仅保留历史归档说明。
