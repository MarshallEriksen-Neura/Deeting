# Browser Extension ↔ Desktop Bridge Expansion Plan

> Created: 2026-04-15
> Status: Draft / Future Enrichment

## Background

当前 `deeting_chrome` 浏览器插件是一个纯粹的**受控执行器**，通过 WebSocket 连接桌面端，只接受桌面端 AI 下发的指令。通信方向是单向的：

```
Desktop ──Command──▶ Extension ──Result──▶ Desktop
```

桌面端已有丰富的知识能力（llm_wiki、knowledge、memory、retrieval_kernel、workflow），但浏览器插件无法触达这些能力，也无法向桌面端回流用户浏览上下文。

### 已排除的方向

- **网页裁剪直通 llm_wiki**：Obsidian 已有 `obsidian_web_clipper` 插件覆盖 browser→vault 的裁剪路径，llm_wiki corpus sync 会自动索引 vault 变更，无需重复建设。

---

## Phase 1 — 上行通道：浏览上下文感知（P0）

### 目标

让桌面端"看见"用户在浏览器中正在做什么，主动关联已有知识。

### 现状

- `protocol.ts` 已定义 `EventMessage` 类型（`tab_updated`, `tab_closed`, `permission_required`, `user_blocked`）
- `bridge.rs` reader loop 只处理 `result` 类型消息，**丢弃了所有 event 消息**

### 需要做的事

1. **桌面端消费浏览器事件**
   - `bridge.rs` reader loop 增加 `event` 消息类型的分发逻辑
   - 建立 `BrowserContextEventBus`，将 `tab_updated` / `tab_closed` 事件广播给感兴趣的模块

2. **插件侧主动推送页面上下文**
   - 新增 `page_context_signal` 事件：用户在某页面停留超过阈值（如 15s）时，插件推送轻量上下文
   - Payload: `{ url, title, domain, headingsSummary, mainTextSnippet(500 chars) }`
   - 节流策略：同一 URL 不重复推送，切标签才更新

3. **桌面端关联查询**
   - 收到 `page_context_signal` 后，调用 `memory::search_unified` / `llm_wiki::search_corpus` 做语义关联
   - 如果找到高相关度匹配，通过 Island 浮出提示

### 关键文件

- `packages/deeting_chrome/src/shared/protocol.ts` — EventMessage 扩展
- `packages/deeting_chrome/src/background/bridge.ts` — 事件推送逻辑
- `deeting/src-tauri/src/modules/browser_agent/bridge.rs:236-249` — reader loop 扩展
- `deeting/src-tauri/src/modules/browser_agent/service.rs` — 事件消费入口

---

## Phase 2 — 反向查询通道：浏览器内触达桌面知识（P1）

### 目标

用户在浏览器内工作时，无需切窗口即可查询桌面端的知识/记忆。

### 协议扩展

当前协议只有 Desktop→Extension 的 command 通道，需要增加反向通道：

```
Extension ──QueryMessage──▶ Desktop ──QueryResultMessage──▶ Extension
```

新增消息类型：

```typescript
interface QueryMessage {
  type: "query"
  queryId: string
  method: "search_knowledge" | "search_memory" | "search_wiki" | "search_unified"
  params: Record<string, unknown>
}

interface QueryResultMessage {
  type: "query_result"
  queryId: string
  ok: boolean
  data?: unknown
  error?: { code: string; message: string }
}
```

### 插件侧

- Popup 或 Side Panel 中提供搜索 UI
- 用户输入查询 → 构造 `QueryMessage` → 通过 WebSocket 发送 → 等待 `QueryResultMessage` → 渲染结果

### 桌面端

- `bridge.rs` reader loop 增加 `query` 消息类型处理
- 路由到对应桌面模块：
  - `search_unified` → `memory::search_unified`
  - `search_wiki` → `llm_wiki::search_corpus`
  - `search_knowledge` → `knowledge` 语义搜索
  - `search_memory` → `memory::search_local_memories`

---

## Phase 3 — 浏览事件驱动 llm_wiki 自动化（P1）

### 目标

将浏览器事件接入 llm_wiki automation trigger 体系，补充 Obsidian Web Clipper "只管裁剪、不管语义关联"的短板。

### 新增 Trigger

| Trigger | 条件 | 建议的 Action |
|---------|------|--------------|
| `on_repeated_topic_browsing` | 同一主题域的页面被访问 3+ 次 | 建议创建 wiki 主题页面 |
| `on_bookmarked_source` | 用户收藏了某个页面 | 建议将其作为 wiki 参考来源跟踪 |
| `on_extended_reading` | 用户在技术文档页面停留 >5min | 建议摘录关键内容到 wiki |

### 实现要点

- 基于 Phase 1 的事件通道，在桌面端维护一个轻量的 `BrowsingTopicTracker`
- 浏览主题识别可以走 embedding 相似度聚类（复用 `providers::embedding`）
- 达到阈值时，写入 `llm_wiki::automation` 的 suggestion 队列

### 关键文件

- `deeting/src-tauri/src/modules/llm_wiki/automation.rs` — 新增 trigger 常量和处理函数

---

## Phase 4 — 页面上下文注入对话（P2）

### 目标

用户在浏览器内看到内容，可以直接和 Deeting AI 讨论"当前页面"。

### 方案

- 插件提供 "Discuss this page" 按钮（popup 或 context menu）
- 点击后调用已有的 `getPageSnapshot()`，通过 WebSocket 发送到桌面端
- 桌面端将 snapshot 作为临时对话上下文注入当前 conversation
- 比 clip 更轻量：不持久化到知识库，仅作为会话上下文

### 关键文件

- `packages/deeting_chrome/src/content/extract.ts` — 已有 getPageSnapshot
- `deeting/src-tauri/src/modules/conversation/` — 上下文注入

---

## Phase 5 — Vault 文件变更监听 → 自动 Corpus Sync（P2）

### 目标

Obsidian Web Clipper 裁剪落盘后，llm_wiki corpus 索引自动实时化。

### 方案

- 桌面端通过 `notify` crate（或 Tauri fs watcher）监听 vault 目录变更
- 检测到新 .md 文件写入时，自动触发 `llm_wiki::sync_corpus`
- 配合 debounce 策略（如 5s 内无新变更才触发）避免频繁 sync

### 关键文件

- `deeting/src-tauri/src/modules/llm_wiki/service.rs` — sync_corpus 入口
- `deeting/src-tauri/src/modules/llm_wiki/automation.rs` — `handle_corpus_sync_completed`

---

## 架构总览

完成所有 Phase 后，浏览器与桌面端将有三条通道：

```
┌──────────────────┐                    ┌──────────────────────────┐
│  Browser Extension│                    │   Desktop (Tauri)        │
│                  │                    │                          │
│  ┌─────────────┐ │  ① Command/Result  │  ┌─────────────────────┐ │
│  │ Executor    │◄├───────────────────►├──┤ browser_agent       │ │
│  └─────────────┘ │  (已有，AI 操控)     │  └─────────────────────┘ │
│                  │                    │                          │
│  ┌─────────────┐ │  ② Event (上行)    │  ┌─────────────────────┐ │
│  │ Context     │─├───────────────────►├──┤ BrowsingContextBus  │ │
│  │ Observer    │ │  (上下文推送)        │  │  → memory           │ │
│  └─────────────┘ │                    │  │  → llm_wiki auto    │ │
│                  │                    │  │  → Island hints      │ │
│  ┌─────────────┐ │  ③ Query (反向)    │  └─────────────────────┘ │
│  │ Knowledge   │─├───────────────────►├──┐                       │
│  │ Panel       │◄├────────────────────├──┤ search_unified       │ │
│  └─────────────┘ │  (查询桌面知识)      │  │ llm_wiki corpus     │ │
│                  │                    │  │ memory               │ │
└──────────────────┘                    │  └──────────────────────┘ │
                                        └──────────────────────────┘
```

---

## Future Hardcore Directions

以下方向利用"本地 AI 桌面端 + 浏览器触手"的独特组合，超出普通浏览器插件的能力边界。

### H1. 知识叠加层（Knowledge Overlay）

插件在网页上**实时叠加**桌面端的知识标注。

- 用户浏览任意网页时，插件提取页面实体（人名、公司、技术概念），通过反向查询通道批量查桌面端 memory + llm_wiki
- 命中的实体高亮显示，hover 弹出用户自己的笔记/记忆摘要
- 效果：用户的个人知识图谱投射到整个互联网上

**与纯浏览器插件的区别**：数据源是用户本地的私有知识库，不是某个云服务的公开数据。

**依赖**：Phase 2 反向查询通道 + `memory::search_unified` + `llm_wiki::search_corpus`

### H2. 矛盾检测（Contradiction Detection）

浏览器中阅读的内容，实时与桌面端已有知识做对比。

- 插件提取当前页面的关键论断（claim extraction）
- 发送到桌面端，和 llm_wiki corpus + memory 做语义对比
- 发现矛盾时（"这篇文章说 X，但你之前记录的是 Y"），在 Island 上弹出提醒
- 用户可以选择更新知识库，或标记为"待验证"

**核心价值**：主动认知辅助——不是用户问才答，而是系统发现用户该注意的东西。

**依赖**：Phase 1 上下文推送 + `providers::embedding` 语义比对 + `retrieval_kernel`

### H3. 自主 Web Research Agent

将当前逐步下发指令的 browser_agent 升级为自主研究引擎。

- 用户给出研究问题（如"调研 Rust 生态中 WASM 运行时的性能对比"）
- 桌面端 AI 规划研究路线，自主打开多个标签页、阅读页面、交叉验证
- 每读一个页面，和已有 knowledge/llm_wiki 做增量关联，避免重复劳动
- 最终输出带引用来源的结构化研究报告，写入 llm_wiki workspace 的 `wiki/analyses/`
- 关键区别：**有记忆**——知道用户之前调研过什么

**现有基础设施**：`retry_with_relocate`、`get_page_snapshot`、`llm_wiki::ingest_selection`
**缺失部分**：多步研究编排引擎（需要在 `workflow` 模块上构建研究型工作流模板）

### H4. 定时自主浏览工作流（Scheduled Web Workflows）

将 browser_agent 能力与 `workflow` 模块结合，实现 cron 驱动的自主浏览任务。

示例场景：
- "每天早上 9 点，打开这个 dashboard，提取 KPI 数据，与昨天对比，写入 wiki 的 analyses 目录"
- "监控这个页面，价格低于 X 时通知我并记录到 memory"
- "每周五扫描这三个竞品官网的 changelog，生成变更摘要"

**本质**：`cron` + `browser_agent` + `llm_wiki` 的三路组合。

**现有基础设施**：workflow 引擎已有 run/proposal 机制，browser_agent 提供执行手臂，llm_wiki 提供输出落地。
**缺失部分**：定时调度器 + 工作流模板中的 browser action step 类型

### H5. 本地优先的表单智能（Form Intelligence）

浏览器检测到用户在填表时，查询桌面端知识辅助填写。

- 插件识别表单字段语义（已有 `inputs` 和 `forms` 提取能力）
- 查询桌面端 memory/knowledge 获取匹配信息
- 弹出建议面板，用户确认后自动填入
- 所有数据留在本地，不经过任何云端

**比浏览器 autofill 强的地方**：理解语义而非死记字段名。"用户之前在 memory 里记录的公司税号"这类非结构化信息也能用上。

**依赖**：Phase 2 反向查询通道 + `memory::search_local_memories`

### H6. 浏览行为作为数字分身信号源（Digital Twin Sensor）

长期方向——浏览器成为用户数字分身的信号采集器。

- 桌面端维护一个用户兴趣/关注领域的 embedding 空间
- 浏览行为持续微调这个空间（停留时间、滚动深度、交互频率作为信号权重）
- 反向影响 llm_wiki 的 `maintenance_schedule` 建议优先级、memory 的重要性排序
- 最终效果：系统越用越懂用户，知识库自动朝用户真正关注的方向演化

**依赖**：Phase 1 事件通道 + `providers::embedding` + `llm_wiki::automation` trigger 体系

**隐私设计要求**：所有浏览行为数据严格本地存储，embedding 空间不可逆向还原为浏览历史。

---

## Open Questions

- [ ] Phase 1 事件推送的节流策略：timer-based vs. navigation-based？
- [ ] Phase 2 反向查询的权限模型：是否需要 policy 层审核？
- [ ] Phase 3 主题聚类的 embedding 调用频率对性能的影响？
- [ ] Side Panel vs. Popup 作为知识查询 UI 的取舍？
- [ ] 是否需要在插件侧缓存最近查询结果减少 WebSocket 往返？
- [ ] H1 知识叠加层的实体提取粒度：NER-based vs. embedding-based？
- [ ] H2 矛盾检测的 claim extraction 应该在插件侧（轻量）还是桌面端（完整）做？
- [ ] H3 自主研究 agent 的并发标签页数量上限和资源控制？
- [ ] H4 定时工作流的调度器：复用 OS cron vs. 桌面端内建 scheduler？
- [ ] H6 浏览行为 embedding 空间的衰减策略：时间衰减 vs. 交互频率衰减？
