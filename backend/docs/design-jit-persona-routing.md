# Design: Deeting OS - Automated Expert Network (JIT Persona Routing)

## 1. 概述 (Overview)

本设计文档旨在阐述 "Deeting OS" 的一项核心进化功能：**代理驱动的即时人格路由 (Agent-Driven JIT Persona Routing)**。

Deeting OS 正在向全自动化 AI 操作系统演进，废弃传统的“手动选择助手”模式。系统在运行时根据上下文，动态检索并融合最适合当前任务的专家人格（Prompt）。

核心理念：**由模型（LLM）而非中间件（Middleware）决定何时切换人格。**

---

## 2. 核心范式转变 (The Paradigm Shift)

| 维度 | 传统助手模式 (Deprecated) | 自动化专家网络 (New) |
| :--- | :--- | :--- |
| **用户操作** | 在侧边栏寻找并点击特定的 Bot | 直接在主界面开始输入 |
| **上下文绑定** | 会话与单一 `assistant_id` 强绑定 | 会话与用户意图动态绑定 |
| **透明度** | 用户明确知道自己在和谁聊天 | 系统自动调度，用户无感或弱感知专家切换 |

---

## 3. 架构设计 (Architecture)

### 3.1 数据层 (Data Layer) - Ref-Only Pattern

采用 **"轻量索引 + 实时回查"** 策略，避免 Qdrant 存储冗余和数据不一致。

*   **Source of Truth (Postgres)**: 存储完整的 `system_prompt` 和版本控制。
*   **Semantic Index (Qdrant)**:
    *   **Collection**: `expert_network`
    *   **Vector**: Embedding(`Name` + `Description` + `System Prompt Summary`)。
    *   **Payload Schema**:
        ```json
        {
          "uuid": "string (assistant_id)",
          "name": "string",
          "category": "string",
          "author_id": "string",
          "rating_score": "float (cached for ranking)",
          "tools_manifest": ["tool_name_1", "tool_name_2"]  // 关键新增：工具依赖声明
        }
        ```

### 3.2 运行时 (Runtime) - The "PersonaRegistryPlugin"

**Tool Definition**: `consult_expert_network(intent_query)`

> 注：运行时检索为性能与成本设置了 Top-K 上限（当前为 50），后续可按策略调整。

**Execution Flow**:
1.  **Search**: `intent_query` -> Vector -> Qdrant Top-K IDs。
2.  **Hydrate**: 后端拿着 IDs 去 Postgres 获取最新版本的 `system_prompt` 和 **关联工具集 (Tool Definitions)**。
3.  **Synthesis**: 模型根据检索到的专家指令，结合当前上下文，在内部合成最适合本次回答的“临时人格指令”。
4.  **Tool Mounting (关键)**: 后端不仅要更新 System Prompt，还要动态地将该专家所需的 Tools 注入到 LLM 的 `tools` 列表中（将在下一次 turn 生效）。

---

## 4. 路由策略与状态机 (Routing Strategy & State Machine)

### 4.1 仲裁协议 (Arbitration Protocol)
当检索到多个专家且指令冲突时，Base System Prompt 中需定义元指令优先级：
> "Meta-Rule: When conflicting instructions arise from retrieved experts:
> 1. **Safety & Ethics** override everything.
> 2. **Task Goal** (e.g., 'write code') overrides **Style Preferences** (e.g., 'be verbose').
> 3. User's explicit constraints (Layer 1) always override Expert's defaults."

### 4.2 感知惯性与会话锁定 (Inertia & Locking)
为了防止模型频繁跳变（Jittering）：
*   **Confidence Threshold**: 只有当新意图的置信度 > 0.8 时才允许调用路由工具。
*   **Session Locking**: 当进入深度任务（如 `coding_mode` 或 `creative_writing`）时，锁定当前 Persona 3-5 个回合 (Turns)，除非用户显式打断（如 "Stop", "Change topic"）。

---

## 5. 工具链动态挂载 (Dynamic Tool Mounting)

**问题**: 专家不仅是 Prompt，更是 Prompt + Tools 的集合体。
**方案**:
*   **Definition**: 在 `AssistantVersion` 表中，除了 `system_prompt`，必须关联 `skill_refs` (引用 Plugin/Tools)。
*   **Runtime Action**:
    *   当 `consult_expert_network` 决定采用某个 Expert 时。
    *   Orchestrator 必须解析该 Expert 依赖的 Tool List。
    *   **Hot-Swap**: 在当前会话的上下文中，动态注册这些 Tools。
    *   **Security**: 确保用户拥有调用这些新 Tools 的权限（需通过权限检查）。

---

## 6. 上下文管理 (Context Management)

### 6.1 动态 System Message
*   **Ephemeral Context**: 检测到 Active Persona 时，覆盖默认 System Prompt。
*   **Cross-Persona Memory**: 切换人格时，保留 `Conversation History` (User/Assistant Messages)，但**丢弃**旧的 `System Instructions`。确保新专家能看到之前的代码/内容，但不受旧规则束缚。

### 6.2 消息归因
*   `ChatMessage` 表新增 `used_persona_id` 记录归因。

---

## 7. 自适应排序与反馈 (Adaptive Ranking & Feedback)

### 7.1 反馈信号
*   用户点赞 (+1) / 点踩 (-1) / 重新生成 (-1)。

### 7.2 算法微调 (MAB + Exploration)
*   **Algorithm**: Thompson Sampling.
*   **Cold Start Bonus**: 为新上架 (< 10 次调用) 的专家增加 `exploration_bonus` (e.g., +0.2 score)，确保它们有曝光机会。
*   **Final Rank**: `(Vector_Sim * 0.6) + (MAB_Score * 0.3) + (Exploration * 0.1)`。

---

## 8. 数据同步机制 (Sync Mechanism)

### 8.1 触发时机
1.  **Review Approved**: 审核通过时，**双写**触发索引任务。
2.  **Version Update**: 发布新版本时重算 Embedding。
3.  **Delete/Hide**: 立即从 Qdrant 移除 Point。

---

## 9. 未来规划：自我进化 (Future: Self-Evolution)

**Phase 6: 自主进化与 Prompt 蒸馏**
*   系统观察模型合成的临时 Prompt 的表现。
*   如果高评价，系统自动将该合成 Prompt **沉淀 (Distill)** 为新的专家版本，实现系统能力的自我繁衍。

---

## 10. 附录：Qdrant Schema 定义

```python
collection_name = "expert_network"
vector_size = 1536 
# Payload 增加 tools 字段
payload_schema = {
    "uuid": "keyword",
    "tools": "keyword[]" 
}
```
