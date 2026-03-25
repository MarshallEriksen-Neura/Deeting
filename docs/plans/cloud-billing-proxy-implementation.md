# 云端计费代理 — 生产级实施计划

> 状态：主体链路已落地，仍有少量后续项，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- 云端 `credits` 代理端点、桌面 `platform` 路由、平台模型同步与桌面鉴权持久化已经进入现行实现。
- 仍可继续补强的方向主要是同一 `trace_id` 的多轮 usage 汇总、限流与更细的审计收口。

## 当前实现入口
- 云端模型列表：`backend/app/api/v1/credits_route.py`
- 云端代理补全：`backend/app/api/v1/credits_route.py`
- 桌面平台代理请求：`deeting/src-tauri/src/modules/mcp/commands_parts/runtime_and_routing.rs`
- 桌面平台模型同步：`deeting/src-tauri/src/modules/providers/commands.rs`
- 前端 credits API：`deeting/lib/api/credits.ts`
- 桌面 token 持久化：`deeting/lib/api/desktop-config.ts`
- 登录态写入/清理 token：`deeting/hooks/use-auth.ts`

## 维护说明
- 如需继续补齐 agentic 多轮 usage 汇总或代理限流/审计，请基于当前 `credits_route` 与桌面平台链路另开新方案。
- 本文件仅保留当前状态，不再维护原始实施拆解。
