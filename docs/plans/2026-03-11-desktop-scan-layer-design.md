# Desktop Scan Layer Design

Date: 2026-03-11

## Summary
当前的 `skills folder scan` 不应继续作为 `assistant` 或 `skills` 的附属逻辑存在，而应被抽离为一个独立的扫描层（scan layer）。该层负责对本地文件或目录做确定性扫描、结构化提取、风险发现与统一结果产出，再将结果提供给秘书模型生成安全报告，或同步到表、LanceDB 等存储目标。

这意味着：
- `assistant` 不再负责 skill 真相，也不应负责扫描入口
- `skills` 是扫描对象之一，而不是扫描能力本身
- 扫描、模型解释、数据同步是三个独立层次

## Why now
- 当前正在进行 `assistant` 与 `skills` 的拆分，正是抽离扫描逻辑的最佳时机。
- 如果继续把扫描逻辑留在 `skills` 模块内部，后续会再次把对象语义混回去。
- 用户已经有两个明确需求：
  - 让秘书模型做全盘扫描或单文件扫描并生成安全报告
  - 复用同一批扫描结果做表同步或 LanceDB 同步

## Position

### 1. Scan layer is infrastructure, not assistant logic
扫描层的定位是底层基础设施：
- 负责取证
- 负责结构化
- 负责可审计结果

它不是 assistant 的人格能力，也不是 skills 的隐式行为。

### 2. Skills are scan targets, not scan engines
当前优先扫描 `skills/` 目录是合理的，但 `skills` 只是第一批扫描对象。

未来同一套扫描层应可扩展到：
- prompt assets
- manifests
- plugins
- user documents
- provider configs

因此模块命名和 contract 不应写死为 `skills_scanner`。

### 3. Model explains, scanner collects evidence
秘书模型负责解释和报告，不负责底层扫描。

职责分离：
- scan layer：遍历、读取、提取、发现风险
- secretary/worker：理解扫描结果，输出用户可读报告
- sinks：把统一结果同步到表或 LanceDB

## Goals
- 将现有 `skills folder scan` 抽为独立扫描层。
- 同时支持单文件扫描与目录/全盘扫描。
- 为安全报告、结构化同步、后续检索复用统一中间结果。
- 让扫描能力不依赖 `assistant -> skills` 关系。

## Non-Goals
- 本轮不实现自动修复或自动重写文件。
- 本轮不让模型直接担任文件系统扫描器。
- 本轮不要求立刻覆盖所有资产类型，只需先支持 `skills/`。
- 本轮不要求把扫描结果直接绑定到 UI 语义。

## Current problem

### 1. Assistant/skills 拆分尚未完成
当前系统仍处于 `assistant` 与 `skills` 解耦过程中。此时若把扫描能力继续附着在 `assistant` 或历史 `assistant -> skills` 关系上，会让新架构再次回退。

### 2. Single-purpose skill scan is too narrow
如果把功能命名和实现都限定为 `skills folder scan`，后续扩展到其他资产时会出现：
- 语义不准
- 重复实现
- 多套扫描逻辑并存

### 3. Scan, report, and sync are currently conflated
当前意图里同时包含：
- 扫描文件系统
- 做安全分析
- 同步到表
- 同步到 LanceDB

这些需求应该共享同一套扫描结果，但不应共享同一段耦合逻辑。

## Target architecture

### A. Scan target layer
定义本次扫描“扫什么”。

最小支持：
- `single_file`
- `directory_tree`

后续可扩展：
- `skill_package`
- `workspace_selection`
- `provider_bundle`

### B. Scan engine
负责确定性扫描，不做高层业务判断。

职责：
- 枚举路径
- 过滤隐藏文件/超大文件/二进制文件
- 识别文件类型、语言、大小、哈希
- 读取文本内容
- 切块或抽取基础结构
- 产生标准化 `ScanDocument`

### C. Analyzer layer
负责从扫描结果中提取发现，但仍优先采用确定性规则。

MVP 建议至少有两个 analyzer：
- `metadata_extractor`
- `security_analyzer`

后续可扩展：
- `manifest_analyzer`
- `dependency_analyzer`
- `prompt_risk_analyzer`
- `policy_analyzer`

### D. Sink layer
负责把统一结果写入不同目标。

MVP 目标：
- `table_sink`
- `lancedb_sink`
- `report_payload_sink`

### E. Secretary/worker consumption layer
秘书模型或 worker 不直接扫目录，而是消费结构化扫描结果，用于：
- 生成安全报告
- 输出风险摘要
- 给出启用/安装建议
- 生成用户可读解释

## Core design rule
一次扫描，统一产出，多处消费。

也就是说：
- 不为安全报告单独扫描一遍
- 不为表同步单独扫描一遍
- 不为 LanceDB 再扫描一遍

正确路径应为：
`scan once -> normalized result -> analyzers -> sinks / report consumers`

## Unified scan model

### ScanRun
代表一次扫描任务。

最小字段：
- `scan_run_id`
- `target_kind`
- `target_path`
- `scope`: `file | directory | workspace`
- `triggered_by`
- `started_at`
- `completed_at`
- `status`
- `stats`

### ScanDocument
代表被扫描出的文件对象。

最小字段：
- `document_id`
- `path`
- `source_kind`
- `media_type`
- `language`
- `size_bytes`
- `content_hash`
- `text_excerpt`
- `metadata`

### ScanFinding
代表一个结构化发现。

最小字段：
- `finding_id`
- `document_id`
- `severity`: `info | low | medium | high | critical`
- `category`
- `title`
- `evidence`
- `line_span`
- `recommendation`
- `confidence`

### IndexRecord
代表供表或 LanceDB 使用的标准化索引对象。

最小字段：
- `record_id`
- `document_id`
- `chunk_id`
- `text`
- `metadata`
- `tags`
- `embedding_status`

## Security report flow

### Single file scan
1. 用户选择一个文件。
2. scan layer 执行确定性扫描。
3. `security_analyzer` 生成 `ScanFinding[]`。
4. 秘书模型读取 `ScanRun + ScanDocument + ScanFinding[]`。
5. 输出安全报告。

### Directory / full scan
1. 用户选择目录或触发全盘扫描。
2. scan layer 生成多文件 `ScanDocument[]`。
3. analyzers 产出汇总 findings。
4. sinks 将结果写入表或 LanceDB。
5. 秘书模型对结果做汇总，生成面向用户的安全报告。

## What the model should see
模型不应直接读取整个目录的原始文件流作为默认输入。

优先输入给模型的是：
- 扫描摘要
- 高风险文件列表
- 结构化 findings
- 抽取到的 manifest / entrypoint / dependency / suspicious patterns

只有在必要时，才追加少量原文片段作为证据。

## Relationship with assistant / skills split

### Before
历史上容易形成：
- `assistant` 挂 `skills`
- runtime 通过 `assistant` 间接知道 skill
- 扫描逻辑也跟着挂在 assistant/skills 关系上

### After
目标应变为：
- `assistant` 不再负责 skills 真相
- `skills` 有自己的表、关系与发现路径
- scan layer 直接面对文件系统/资产源
- runtime 或秘书模型只是 scan layer 的消费者

这份设计默认接受一个事实：
> 即使 `assistant` 与 `skills` 的拆分尚未完全落地，扫描层也要先按独立架构设计。

## Relationship with storage sync

### Table sync
表同步用于：
- 保存扫描 run
- 保存扫描到的 document 元数据
- 保存 findings 与审计轨迹

### LanceDB sync
LanceDB 用于：
- 保存 document chunk 或摘要
- 支持后续语义检索
- 为秘书模型或搜索功能提供向量召回基础

原则：
- LanceDB 吃的是标准化 `IndexRecord`
- 不直接依赖目录扫描细节

## Runtime usage patterns

### 1. Direct usage
单文件扫描或快速目录扫描，可直接调用 scan capability。

### 2. Worker-assisted usage
如果需要自然语言安全报告、风险解释、安装建议，可在扫描结束后进入 worker / secretary 分析路径。

### 3. CodeMode usage
只有当后续要做批量修复、批量重写、自动整理、跨文件程序化处理时，才需要进入 codemode。

结论：
- 扫描本身不天然属于 codemode
- 报告生成也不天然属于 codemode
- 程序化批处理才属于 codemode

## MVP plan

### Phase 1: isolate scan layer
- 从现有 `skills folder scan` 中抽出纯扫描入口
- 支持 `scan_file` 与 `scan_directory`
- 统一输出 `ScanRun / ScanDocument / ScanFinding`

### Phase 2: add security analyzer
- 增加基础 `security_analyzer`
- 检测 manifest、执行入口、可疑脚本、外部调用、危险模式
- 产出结构化 findings

### Phase 3: add sinks
- 将统一结果接入表存储
- 将标准化记录接入 LanceDB
- 不重复扫描

### Phase 4: secretary report generation
- 让秘书模型消费扫描结果
- 输出用户可读安全报告
- 给出建议，但不直接修改文件

## Acceptance criteria
- 扫描能力不再依赖 `assistant -> skills` 关系。
- 同一套扫描层既能扫单文件，也能扫目录。
- 安全报告与数据同步复用同一批扫描结果。
- 模型负责解释，扫描层负责取证，sink 负责落库。
- 未来扩展到非 `skills` 资产时，无需重写扫描架构。

## Open questions
- 全盘扫描是同步返回，还是后台 job + 进度流更合适。
- 表层是否需要单独保存 `ScanDocument` 原文摘要，还是只保存元数据与 findings。
- LanceDB 里是写全文 chunk、摘要 chunk，还是两者并存。
- 安全 analyzer 的规则体系是硬编码、配置化，还是逐步演化为策略表。

## Final decision
当前 `skills folder scan` 的正确演进方向，不是继续做成 skills 内部功能，而是提升为独立 scan layer：扫描负责取证，秘书模型负责报告，table/LanceDB 负责落库与检索，三者共享统一的扫描结果模型。