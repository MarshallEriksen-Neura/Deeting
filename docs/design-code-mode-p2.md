# P2: 完整 Code Mode 实现规划

> 状态：核心 P2 能力已落地，仍有少量文档补完项，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- Code Mode 的运行时协议、tracing、metrics、审计、执行记录、回放 API 等核心能力已经进入现行实现。
- 仍未完全补齐的主要是更系统化的开发者文档与错误码文档，不影响当前主链路。

## 当前实现入口
- 协议解析：`backend/app/services/code_mode/protocol.py`
- Tracing：`backend/app/services/code_mode/tracing.py`
- 审计服务：`backend/app/services/code_mode/audit_service.py`
- 执行记录模型：`backend/app/models/code_mode_execution.py`
- 执行记录仓储：`backend/app/repositories/code_mode_execution_repository.py`
- 内部 API：`backend/app/api/v1/internal/code_mode_routes.py`
- 前端 API 测试：`deeting/lib/api/__tests__/code-mode.test.ts`
- 当前桥接文档：`docs/api/desktop-code-mode-bridge.md`

## 维护说明
- 如需继续补齐 Code Mode 文档体系，请单独整理 `docs/code-mode/*`，避免和现行运行时设计混写。
- 本文件仅保留历史归档说明。
