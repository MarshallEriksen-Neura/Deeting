# Desktop 本地记忆 API（LanceDB）

更新时间：2026-03-04

## 范围说明
- 本文档描述桌面端（Tauri）新增的本地记忆命令。
- 存储介质：LanceDB（本地目录）。
- 当前版本仅支持存储结构 CRUD，不包含 embedding 生成与向量检索。

## 与云端架构边界（避免混淆）
- Desktop 本地记忆是离线本地能力，当前不依赖云端 PostgreSQL / Meilisearch / Qdrant。
- 云端 Assistant 市场的真实架构是：
  - SQL（`assistant` / `assistant_version` / `assistant_install` / `assistant_tag_link` / `assistant_rating`）作为单一事实源；
  - Meilisearch 负责 market/public 列表与关键词检索；
  - Qdrant（`expert_network`）负责语义候选助手召回。
- 云端知识（Scout）链路是：
  - 爬取后原始 Markdown 先入 `knowledge_artifact`，状态为 `pending_review`；
  - 审核通过后异步分块写 `knowledge_chunk`，并向量化写入 Qdrant 系统知识集合（默认 `kb_system`）。
- Assistant 进入 `expert_network` 有门禁：通常需满足 `public + published`，且用户助手需审核通过（系统助手例外）。
- 结论：对 Assistant 市场应理解为 `SQL（真源）+ Meilisearch（市场检索）+ Qdrant（语义路由）`，而不是仅 `SQL + Qdrant`。

## Desktop Plugins / Skills 落地架构（定稿，2026-03-04）

### 目标与原则
- 目标：让桌面端在不复制云端全量复杂度的前提下，稳定实现“发现、安装、检索、执行”闭环。
- 原则：`云端发现，本地缓存，按需安装，本地执行`。
- 架构分层：
  - 云端是控制面（Control Plane）：市场、全量检索、分发清单。
  - 桌面是数据面（Data Plane）：已安装集合、本地索引、本地执行。

### 职责边界（必须严格执行）
- 云端负责：
  - 市场列表与搜索（关键词/语义）。
  - Skill Manifest 分发（`manifest_json`）。
  - 用户安装意图同步（跨设备恢复所需最小状态）。
- 桌面负责：
  - 本地安装状态真相源（SQLite）。
  - 本地向量索引（LanceDB，仅索引已安装且启用）。
  - 本地运行时与进程管理（本地命令、脚本、MCP 工具）。
- 明确不做：
  - 不做桌面全量技能镜像。
  - 不把云端 Qdrant 作为桌面对话时执行依据。
  - 不允许未安装插件进入桌面对话执行路径。

### 生命周期（Desktop）
1. 发现（Discover）
- 用户打开市场时，桌面实时请求云端市场 API。
- 结果仅用于展示，不写入本地安装库。

2. 安装（Install）
- 点击安装后，桌面拉取目标 skill 的 `manifest_json`。
- 写入本地安装记录（`installed/enabled/version/runtime/install_path`）。
- 若 runtime 需要本地源码（python/nodejs/script），下载/克隆到本地插件目录。
- 将可检索描述写入 LanceDB（仅本地已安装且启用资产）。

3. 对话检索（Conversation JIT）
- 只允许检索“本地已安装且启用”的工具/assistant。
- 市场全量检索只用于 UI，不得直接注入对话执行 catalog。

4. 执行（Execution）
- 本地 runtime：桌面执行并回传结果。
- `cloud_api` runtime：可远程调用，但执行入口仍由本地安装态门禁控制。

5. 卸载（Uninstall）
- 软/硬卸载后，从本地安装库移除或禁用。
- 同步清理 LanceDB 对应索引项，避免被 JIT 命中。

### 双层 JIT 模型（推荐）
- 层 A（市场检索）：
  - 面向“发现”，可查询云端全量库。
  - 输出用于 UI 列表、安装入口。
- 层 B（对话决策）：
  - 面向“执行”，只查询本地已安装且启用库。
  - 输出用于 Prompt 工具目录与运行时路由。

### 本地数据模型（最小集）
- 安装真相源（SQLite，建议）：
  - `local_skill_install`：
    - `user_id`（与本地账号上下文绑定）
    - `skill_id`（PK）
    - `installed_version`
    - `is_enabled`
    - `runtime`
    - `manifest_json`
    - `install_path`
    - `user_settings_json`
    - `installed_at / updated_at`
- 本地索引（LanceDB）：
  - 仅存“已安装+已启用”技能/助手向量。
  - 必须带 `source_type=local_installed`（或等价标记）用于执行前过滤。

### 同步策略（跨设备）
- 只同步配置，不同步全量资产：
  - `skill_id`
  - `installed_version`
  - `is_enabled`
  - 用户安装配置（alias / pinned 等）
- 新设备登录后按清单执行重装（re-install）。
- 禁止自动拉取云端全量技能到桌面。

### 对当前实现的落地要求（P0）
- 对话候选过滤：
  - `consult_expert_network` / 本地候选检索必须增加安装态过滤（仅 `installed + enabled`）。
- 本地 SDK/工具目录过滤：
  - 聊天态 catalog 中的 `cloud_mirror` 资产只能作为“可安装提示”，不得作为可执行工具暴露。
- 执行门禁统一：
  - 运行前再次校验本地安装态，防止绕过检索层直接执行。
  - 未安装/未启用工具调用应返回统一错误码（建议：`LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED`），用于前端与日志观测。

### 分阶段推进（建议）
1. Phase 1（1-2 天）
- 先补“对话层安装门禁”与“catalog 过滤”，不改大 schema。
2. Phase 2（3-5 天）
- 建立统一的 `local_skill_install` 与安装目录生命周期管理。
- 当前进展：已落地 `local_skill_install` 表与扫描写入（`register_local_skills` upsert），并将对话检索接入已启用安装过滤（assistant + skill 双门禁）。
3. Phase 3（可选）
- 更新（2026-03-16）：该阶段已取消。
- 云端不再保存用户级 skill 安装状态。
- 桌面端不再从 `/api/v1/plugin-market/installs` 或 skill feed 同步安装态。
- 当前唯一安装真源为桌面本地 `local_skill_install`。
- 下方旧的“当前进展”记录仅保留历史背景，已不再适用。
- 增加跨设备“安装清单同步 + 自动重装”。
- 当前进展：已新增桌面命令 `sync_local_skill_installs_from_cloud`（轻同步拉取 `/api/v1/plugin-market/installs`），并支持 `reinstall_missing=true` 时按云端安装清单尝试本地重装（git clone）后落库。
- 当前进展（前端接入）：桌面端插件市场请求前会自动触发轻同步（失败降级）；安装/卸载后会强制触发一次同步；插件页新增手动入口并拆分为“仅同步”与“同步并重装缺失”两类操作。
- 当前进展（收敛保障）：同步会将“已标记为 cloud_plugin_market 来源但不在云端安装清单中的本地技能”自动置为禁用，防止卸载后继续进入本地执行链路。

### 验收标准（Definition of Done）
- 市场可看到云端全量；对话仅看到本地已安装启用。
- 未安装插件在任意路径下都不能被本地执行。
- 卸载后 1 次索引周期内从 JIT 结果中消失。
- 离线状态下，本地已安装插件仍可检索与执行（cloud_api 类型除外）。

## 环境变量
- `DESKTOP_LANCEDB_PATH`（可选）
  - 含义：本地 LanceDB 数据目录。
  - 默认值：`<app_data_dir>/memory_lancedb`。
  - 示例（Windows）：`C:\Users\<you>\AppData\Roaming\deeting\memory_lancedb`

## 数据结构
### LocalMemoryItem
```json
{
  "id": "uuid",
  "content": "string",
  "session_id": "string | null",
  "assistant_id": "string | null",
  "meta_info": {},
  "created_at": "RFC3339",
  "updated_at": "RFC3339"
}
```

### LocalMemoryListResponse
```json
{
  "items": [],
  "next_cursor": "created_at|id",
  "has_more": false
}
```

## Tauri Commands
### 1) `append_local_memory`
- 入参：
```json
{
  "content": "string, required",
  "session_id": "string | null",
  "assistant_id": "string | null",
  "meta_info": {}
}
```
- 返回：`LocalMemoryItem`
- 错误：
  - `validation error: content is required`
  - `storage error: ...`

### 2) `list_local_memories`
- 入参：
```json
{
  "query": {
    "cursor": "string | null",
    "limit": 30,
    "session_id": "string | null",
    "assistant_id": "string | null"
  }
}
```
- 返回：`LocalMemoryListResponse`
- 说明：
  - 仅返回未删除数据；
  - `limit` 范围：`1..=200`，默认 `30`。

### 3) `delete_local_memory`
- 入参：
```json
{
  "id": "string, required"
}
```
- 返回：
```json
{
  "id": "string",
  "deleted": true
}
```
- 说明：软删除（`is_deleted=true`）。

### 4) `clear_local_memories`
- 入参：
```json
{
  "payload": {
    "session_id": "string | null",
    "assistant_id": "string | null"
  }
}
```
- 返回：
```json
{
  "cleared": 0
}
```
- 说明：批量软删除，`payload` 为空时清理全部未删除记录。

## Desktop JIT Assistant Routing (2026-03-04)

This section documents desktop-side JIT assistant retrieval behavior for local chat.

### Goal
- Align desktop local chat with cloud-style JIT persona routing behavior.
- Support both modes:
  - Locked assistant (`assistant_id` is set)
  - Auto mode (`assistant_id = null`)

### Entry Points
- Frontend local send/regenerate now allows `assistant_id` to be empty in auto mode.
- Backend local send/regenerate reads and updates session-level assistant lock.

### Core Flow
1. If session has locked assistant:
   - Use that assistant directly.
   - Do not expose `consult_expert_network`.
2. If no lock:
   - Initial local retrieval may pick one assistant from vector search.
   - Tool catalog includes `consult_expert_network`.
3. If model calls `consult_expert_network`:
   - Read `intent_query`, `k`, `confidence`.
   - Only execute candidate retrieval when `confidence >= 0.8`.
   - Return ranked local assistant candidates.
   - If candidates exist, activate top-1 assistant and persist session lock.
4. After activation:
   - Inject assistant system prompt into following turns.
   - Remove further expert routing for the same loop/session (locked behavior).

### Tool Contract (Desktop Local)
- Name: `consult_expert_network`
- Parameters:
  - `intent_query: string` (required)
  - `k: integer` (optional, default 3, max 10)
  - `confidence: number` (required, 0..1)
- Threshold:
  - `LOCAL_JIT_PERSONA_CONFIDENCE_THRESHOLD = 0.8`

### Persistence
- Session lock is stored in `conversation_session.assistant_id`.
- Desktop backend API can set/clear lock:
  - `set_local_conversation_assistant(session_id, Some(assistant_id))`
  - `set_local_conversation_assistant(session_id, None)`

### Bandit Strategy (Desktop Local JIT)
- Selection now uses bandit scoring instead of pure vector top-1.
- Candidate ranking score:
  - `final_score = 0.6 * vector_score + 0.4 * bandit_score`
  - `bandit_score` uses posterior mean + UCB-like exploration bonus.
- Activation policy:
  - adaptive epsilon-greedy (`base=0.12`, cold-start boost, max `0.35`)
  - exploration bucket: top `K=3` candidates
- Confidence gate for `consult_expert_network` remains:
  - dynamic threshold (base `0.8`, then adjusted by query length and candidate quality)

### Observability
- Stream status meta now includes `assistant_routing` diagnostics:
  - candidate_count
  - selection mode (`single` / `exploit` / `explore`)
  - effective epsilon and explore_top_k
  - top candidate score breakdown (`vector_score`, `bandit_score`, `final_score`)

### Runtime Tuning (Env)
- Bandit:
  - `DEETING_LOCAL_ASSISTANT_BANDIT_VECTOR_WEIGHT`
  - `DEETING_LOCAL_ASSISTANT_BANDIT_SCORE_WEIGHT`
  - `DEETING_LOCAL_ASSISTANT_BANDIT_EPSILON`
  - `DEETING_LOCAL_ASSISTANT_BANDIT_MAX_EPSILON`
  - `DEETING_LOCAL_ASSISTANT_BANDIT_EXPLORE_TOP_K`
  - `DEETING_LOCAL_ASSISTANT_BANDIT_EXPLORATION_COEFFICIENT`
  - `DEETING_LOCAL_ASSISTANT_BANDIT_COLD_START_TRIALS`
  - `DEETING_LOCAL_ASSISTANT_BANDIT_COLD_START_EPSILON_BOOST`
- JIT confidence threshold:
  - `DEETING_LOCAL_JIT_PERSONA_CONFIDENCE_BASE`
  - `DEETING_LOCAL_JIT_PERSONA_CONFIDENCE_MIN`
  - `DEETING_LOCAL_JIT_PERSONA_CONFIDENCE_MAX`
  - `DEETING_LOCAL_JIT_PERSONA_SHORT_QUERY_BOOST`
  - `DEETING_LOCAL_JIT_PERSONA_LONG_QUERY_RELIEF`
  - `DEETING_LOCAL_JIT_PERSONA_WEAK_CANDIDATE_BOOST`
  - `DEETING_LOCAL_JIT_PERSONA_STRONG_CANDIDATE_RELIEF`
  - `DEETING_LOCAL_JIT_PERSONA_SCORE_SPLIT_BOOST`
  - `DEETING_LOCAL_JIT_PERSONA_SHORT_QUERY_CHARS`
  - `DEETING_LOCAL_JIT_PERSONA_LONG_QUERY_CHARS`
