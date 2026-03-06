# Design: Assistant Market Upload & Metadata Lifecycle

> 状态：核心审核闭环已落地，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- Assistant 的审核任务、审核状态流转，以及审核通过后同步到搜索 / Qdrant 的主链路已经进入现行实现。
- 本文件不再维护详细的生命周期推演，后续以 review、assistant market service 与同步任务为准。

## 当前实现入口
- 审核任务模型：`backend/app/models/review.py`
- 通用审核服务：`backend/app/services/review/review_service.py`
- 助手市场服务：`backend/app/services/assistant/assistant_market_service.py`
- 助手服务中的 expert network 门禁：`backend/app/services/assistant/assistant_service.py`
- 助手路由：`backend/app/api/v1/assistants_route.py`
- Qdrant 同步任务测试：`backend/tests/tasks/test_assistant_sync_task.py`

## 维护说明
- 如需继续调整上架审核策略或元数据规范，请围绕 assistant market / review 现行链路另开新方案。
- 本文件仅保留历史归档说明。
