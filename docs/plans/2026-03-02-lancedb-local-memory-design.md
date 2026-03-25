# LanceDB 本地记忆存储设计（桌面端）

日期：2026-03-02

> 状态：桌面端本地记忆的核心存储链路已落地，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- LanceDB 已接入桌面端本地记忆存储与初始化流程。
- 当前范围以桌面 Rust 实现和 API 文档为准，不再继续维护这份历史设计的详细推演。

## 当前实现入口
- 应用启动初始化：`deeting/src-tauri/src/setup.rs`
- LanceDB 存储实现：`deeting/src-tauri/src/modules/memory/store.rs`
- 状态封装：`deeting/src-tauri/src/modules/memory/mod.rs`
- 前端调用入口：`deeting/lib/api/local-memory.ts`
- API 文档：`docs/api/desktop-local-memory.md`

## 维护说明
- 如果后续扩展 embedding、向量召回或更复杂的本地记忆策略，请基于当前 Rust 模块重新开新方案。
- 本文件仅保留落地状态说明。
