# Design: Assistant Market Upload & Metadata Lifecycle

## 1. 概述 (Overview)

为了支撑 JIT 路由功能，我们需要一个高质量的元数据源。本设计规范了 Assistant 的上架流程、元数据要求以及审核闭环逻辑。

## 2. 元数据规范 (Metadata Specification)

| Field | Source | Description |
| :--- | :--- | :--- |
| `name` | `AssistantVersion.name` | 专家名称 |
| `summary` | `Assistant.summary` | 简短简介，用于向量 Embedding 的一部分 |
| `category` | `Metadata` | 一级分类（coding, writing 等） |
| `system_prompt` | `AssistantVersion.system_prompt` | 核心指令，提取特征用于检索 |

---

## 3. 上架流程与审核闭环 (Review Loop)

### 3.1 流程定义
1.  **用户发布**: 状态变为 `PENDING_REVIEW`。
2.  **审核任务**: 生成 `ReviewTask`，触发 `AssistantAutoReviewService`。
3.  **状态变更 (关键 Hook)**: 仅当 `ReviewTask` 状态流转为 **`APPROVED`** 时，系统异步触发 `sync_assistant_to_qdrant`。

### 3.2 意义
确保专家库中没有任何未经审核或低质量的内容，保证路由的安全性。

---

## 4. 移除显式 Assistant ID 的影响分析

### 4.1 前端影响 (Frontend)
*   **路由**: 废弃 `/chat/{assistant_id}`，统一使用 `/chat`。
*   **Store**: `createConversation` 不再需要 `assistant_id`。

### 4.2 后端影响 (Backend)
*   **Conversation Model**: `assistant_id` 设为 Nullable。
*   **Chat API**: 默认加载 "Router Base Prompt"。
*   **归因**: 记录 `used_persona_id` 用于奖励结算。

---

## 5. 总结

本设计确保了从用户上传到 AI 自动调度的完整闭环，通过审核机制保证质量，通过 JIT 路由提升体验。
