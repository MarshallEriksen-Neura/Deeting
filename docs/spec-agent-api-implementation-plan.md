# Spec Agent API Implementation Plan

> 状态：主体 API 已落地，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- Spec Agent 的 draft / detail / list / status / start / interact / node detail / rerun / node event / node update 等核心 API 已进入现行实现。
- 本文件不再维护原始实施拆解，后续以 API 路由、service、schema 与测试为准。

## 当前实现入口
- API 路由：`backend/app/api/v1/spec_agent_route.py`
- 服务实现：`backend/app/services/agent/spec_agent_service.py`
- API schema：`backend/app/schemas/spec_agent_api.py`
- 对外 API 文档：`docs/api/spec-agent.md`
- API 回归测试：`backend/tests/api/test_spec_agent_api.py`
- 服务层测试：`backend/tests/services/test_spec_agent_service.py`

## 维护说明
- 如需继续扩展 Canvas 交互、审批状态机或节点编辑能力，请直接基于现有 Spec Agent API 重新开新方案。
- 本文件仅保留历史归档说明。
