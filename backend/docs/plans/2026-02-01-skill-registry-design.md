# Design: Skill Registry v1（Library-first）

## 1. 背景与目标
为了支撑“技能原子化 + 语义检索 + 沙盒执行”的内核能力，需要一个统一的技能注册表，作为 JIT 检索与执行装配的单一事实源。该注册表以 **Library-first** 为优先运行模式，并兼容后续扩展到 CLI/MCP 等多运行时。

**目标**
- 统一存储技能元数据与运行时约束，支持检索、执行与治理闭环。
- 保持与 Assistant/Plugin 的“检索层一体、执行层分离”的架构一致性。
- 允许爬虫/秘书 Agent 自动生成可用的 Manifest 并落库。

**非目标**
- 不在本阶段实现完整技能市场/公开发布机制（参考 `assistant-skill-marketplace-plan.md`）。
- 不强制所有技能转换为插件包形态，仅要求最小可执行元数据。

## 2. 设计原则
1) **检索一体、执行分离**：Assistant 与 Skill 可共用语义库，但执行路径完全独立。  
2) **Library-first**：优先支持 Python/Node 库级调用，允许 LLM 在沙盒内编写细粒度逻辑。  
3) **最小可运行**：Manifest 必须包含最小可执行示例，避免“只能看不能用”。  
4) **可治理**：运行时约束（CPU/Mem/网络）与风险等级必须显式声明。  
5) **可复现**：记录 repo revision/hash，保证构建稳定性。

## 3. 数据模型草案
### 3.1 `skill_registry`（核心表）
用于存储技能的主元数据与完整 Manifest（JSON）。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | string | 全局唯一 ID（如 `docx_structure_editor`） |
| `name` | string | 可读名称 |
| `type` | string | 固定 `SKILL` |
| `runtime` | string | `python_library` / `node_library` / `cli` / `mcp` |
| `version` | string | 语义化版本 |
| `status` | string | `draft` / `active` / `disabled` |
| `description` | text | 检索描述（LLM/向量） |
| `source_repo` | string | Git 仓库 URL |
| `source_subdir` | string | 子目录路径 |
| `source_revision` | string | commit/tag |
| `risk_level` | string | `low`/`medium`/`high` |
| `complexity_score` | number | 复杂度/Token 权重评估（用于检索注入预算） |
| `manifest_json` | json | 完整 Manifest（v1） |
| `vector_id` | string | Qdrant 索引引用 |
| `created_at` | datetime | 创建时间 |
| `updated_at` | datetime | 更新时间 |

> 说明：`manifest_json` 为单一事实源；常用字段在表中冗余，便于查询与路由。

### 3.2 `skill_capability`（检索补充标签）
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `skill_id` | string | 外键 |
| `capability` | string | 关键词（动作/对象） |

### 3.3 `skill_dependency`（依赖清单）
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `skill_id` | string | 外键 |
| `dependency` | string | 依赖库名称 |

### 3.4 `skill_artifact`（产物类型）
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `skill_id` | string | 外键 |
| `artifact_type` | string | `file` / `text` / `json` |

## 4. Manifest v1（最小可执行规范）
Manifest 作为“爬虫秘书”产物，是系统的 **最小可用技能说明书**。

**LLM 关注字段（进入检索/上下文）**
- `description`
- `capabilities`
- `io_schema`
- `usage_spec.example_code`

**执行关注字段（进入沙盒装配）**
- `installation`
- `env_requirements`
- `execution`
- `security`
- `source`
 - `workspace_protocol`

> v1 结构参考前文讨论，且必须包含最小可运行示例。

## 5. 检索与装配流程
1. **爬虫/秘书 Agent** 解析仓库 → 生成 Manifest → 写入 `skill_registry` + Qdrant。  
2. **JIT 检索** 从统一语义库获取候选资源；若命中 Skill 则按权重优先。  
3. **装配阶段**：  
   - `runtime=python_library` → OpenSandbox 内 `git clone` + `pip install`  
   - 将 `usage_spec.example_code` 与用户意图拼接成可执行脚本  
4. **执行回传**：根据 `artifacts` 类型回传产物，并记录 `observability.metrics`。  

### 5.1 环境指纹（Environment Context）
为避免运行环境不一致导致执行失败，Manifest 中必须显式声明环境要求：
- `env_requirements.python_version`：最低 Python 版本（如 `>=3.10`）。  
- `env_requirements.system_packages`：需要 `apt-get install` 的系统依赖（如 `libxml2`、`ffmpeg`）。  

### 5.2 沙盒预热与缓存策略（Execution Lifecycle）
降低 “git clone + pip install” 的冷启动成本，建议引入两级缓存：
- **Pre-warm**：高频技能（如 docx/pdf）在系统启动或检测到相关文件上传时，后台异步构建基础镜像。  
- **Snapshot**：对 `source_revision + dependencies + env_requirements` 生成 `image_hash`。若不变则直接复用快照。  

### 5.3 Stateful Skills（多轮对话的上下文持久化）
对文件处理类技能采用 Session 绑定策略：
- **Session Binding**：同一会话内复用沙盒实例，避免重复解压/加载文件。  
- 超时或任务结束后释放，避免资源泄露。  

### 5.4 Failed Spec Handling（自我纠错）
当 LLM 根据 `example_code` 生成脚本执行失败时：
- 捕获 Traceback → 回喂 LLM 触发一次自我纠错。  
- 若连续失败，则自动标记 `status=needs_review` 或提升 `risk_level`，并回传给“管理员秘书”。

### 5.5 技能反馈环（Feedback Loop）
为实现 OS 级自愈能力，系统需持续统计技能执行稳定性：
- 记录 `success_rate` 与连续失败次数。  
- 若同一技能在不同会话中连续失败 ≥ N 次，自动下线：`status=disabled`。  
- 触发管理员告警并进入复审流程。  

## 6. 安全与治理
- `security.allow_network/allow_shell` 默认 **deny-by-default**。  
- `risk_level=high` 触发人审/确认流程（Spec 审批）。  
- 沙盒运行时必须使用 `execution` 约束（CPU/Mem/Timeout）。  
  
### 6.1 标准工作空间协议（Workspace Protocol）
为避免路径混乱导致执行失败，要求所有技能遵循统一的工作空间协议：  
- Manifest 中声明 `workspace_protocol.root_dir_param`（如 `ROOT_DIR`）。  
- LLM 生成的脚本禁止使用绝对路径，所有文件路径必须基于 `ROOT_DIR`。  

## 7. 与现有体系的关系
- 与 `agent_plugins`：注册表是“技能资源池”，插件是“执行实现”。  
  未来可扩展映射：`skill_registry.runtime=plugin`。  
- 与 `assistant-skill-marketplace-plan.md`：本设计覆盖内部检索与执行，不涉及公开市场。  
- 与 `design-jit-tool-retrieval.md`：可复用现有 JIT 检索思路，仅替换工具来源为技能注册表。

## 8. 里程碑（建议）
- **M0**：设计落地 + Manifest v1 + 表结构原型（已落地）  
- **M1**：爬虫秘书落库 + Qdrant 检索（已落地）  
- **M2**：OpenSandbox 端到端执行验证（docx 示例，已落地 Dry Run + Self‑Heal + 执行链路）

## 9. 附录：Manifest 示例（docx）
```json
{
  "id": "docx_structure_editor",
  "type": "SKILL",
  "runtime": "python_library",
  "version": "1.0.0",
  "description": "专业的 Word (.docx) 文档结构化编辑工具，支持追踪修订、批注与 OpenXML 级别控制。",
  "capabilities": ["docx", "track-changes", "comments", "openxml"],
  "source": {
    "repo": "https://github.com/ComposioHQ/awesome-claude-skills.git",
    "sub_dir": "document-skills/docx",
    "revision": "commit_or_tag"
  },
  "installation": {
    "method": "git_clone",
    "dependencies": ["defusedxml", "lxml", "python-docx"]
  },
  "env_requirements": {
    "python_version": ">=3.10",
    "system_packages": ["libxml2", "libxslt1-dev"]
  },
  "io_schema": {
    "inputs": [
      {"name": "docx_path", "type": "file", "required": true},
      {"name": "instructions", "type": "string", "required": true}
    ],
    "outputs": [
      {"name": "output_docx", "type": "file", "required": true}
    ]
  },
  "usage_spec": {
    "entry_class": "skills.docx.scripts.document.Document",
    "example_code": "from skills.docx.scripts.document import Document\n\ndoc = Document('workspace/unpacked_folder', author='DeetingAgent', initials='DA')\nnode = doc[\"word/document.xml\"].get_node(tag='w:p', line_number=10)\n\ndoc[\"word/document.xml\"].suggest_deletion(node)\ndoc.add_comment(start=node, end=node, text='请核实此处财务数据')\n\ndoc.save(validate=True)\n"
  },
  "execution": {
    "timeout_seconds": 120,
    "memory_mb": 2048,
    "cpu_limit": 2,
    "requires_file_mount": true
  },
  "security": {
    "allow_network": false,
    "allow_shell": false,
    "risk_level": "medium"
  },
  "artifacts": [{"type": "file", "name": "output_docx"}],
  "observability": {
    "metrics": ["exec_time_ms", "output_size_bytes", "error_code"]
  }
}
```

## 10. RepoIngestionService（可插拔解析器 v1）
目标：从“网页爬虫”升级为“仓库解析”，实现 Library-first 的可运行技能入库。

### 10.1 角色与职责
**RepoIngestionService（Orchestrator）**  
- 负责 repo clone、目录快照、解析器调度、Manifest 生成与落库。  
- 只做流程编排，不关心语言细节。  

**RepoParserPlugin（解析器接口）**  
- 负责语言/生态特定的解析规则。  
- 统一接口：  
  - `can_handle(repo_context)`  
  - `collect_evidence(repo_context)`  
  - `extract_manifest(evidence)`  

**EvidencePack（证据包）**  
- 解析器从仓库提取的“高价值素材集合”，用于 LLM 生成 Manifest。  
- 典型内容：README、Docstring、requirements/package.json、核心脚本路径列表。  

### 10.2 核心类草案（概念级）
```
RepoContext(repo_url, revision, root_path, file_index)
RepoIngestionService
  - select_parser()
  - build_evidence()
  - generate_manifest()
  - persist_manifest()
RepoParserPlugin (abstract)
  - can_handle()
  - collect_evidence()
  - extract_manifest()
PythonRepoParser / NodeRepoParser
EvidencePack(readme, deps, entrypoints, snippets, metadata)
```

### 10.3 解析器最小行为约束（v1）
- **PythonRepoParser**：优先读取 `requirements.txt`、`pyproject.toml`；从 import/Docstring 中提炼依赖与示例入口。  
- **NodeRepoParser**：优先读取 `package.json`、`README`；从 `bin`/`exports`/`scripts` 识别入口。  
- 必须产出 **可执行示例**（20-40 行），否则标记为 `status=needs_review`。  
- 增加 **环境探测器**：若检测到重型系统依赖（如 `opencv`、`detectron2`），自动提升 `risk_level`，并要求指定 `base_image`。  

### 10.4 目标闭环
1) 解析器产出 EvidencePack → LLM 生成 Manifest  
2) Manifest 落库 skill_registry + 向量索引  
3) JIT 检索命中 → OpenSandbox 装配执行  
4) 失败回传 → 触发 failed_spec_handling → 修正/复审  

## 11. 闭环风险清单与对策
### 11.1 依赖地狱（Dependency Hell）
**现象**：`pip install` 成功但运行时报缺失 `glibc` 或系统 SO。  
**对策**：解析阶段启用环境探测器，重型依赖提升 `risk_level` 并绑定 `base_image`。  

### 11.2 示例代码语义幻觉
**现象**：示例看似正确，但 API 已更新导致执行失败。  
**对策**：引入 **Dry Run 预演**：入库后异步触发 `skill_registry.dry_run_skill` 执行 `example_code`（队列：`skill_registry`）。  
未通过者进入 `dry_run_fail`，连续失败达到阈值进入 `needs_review`。  
同时触发 **Self‑Heal**（每次失败自动触发，最多 N=2 次/技能）。

### 11.3 文件挂载点混乱
**现象**：脚本在 `/tmp` 找文件，但实际挂载在 `/workspace`。  
**对策**：强制 `workspace_protocol`，统一 `ROOT_DIR` 入口。  

## 12. 审核状态机（Admin Workbench）
建议在 `status` 之外维护审核流转状态（或扩展为枚举）：  
- `scanned`：仓库初次发现，仅记录元信息，不可检索。  
- `dry_run_fail`：预演失败，自动重试一次，仍失败则进入复审。  
- `reviewing`：管理员修正依赖/示例代码。  
- `active`：通过预演与审核，进入 Qdrant 可检索。  
- `disabled`：反馈环触发下线或人工停用。  

## 13. M1 闭环验证清单（验收标准）
为确保从“发现 → 检索 → 执行”真正闭环，M1 必须满足以下可验证条件：

### 13.1 解析与入库
- 至少 3 个 Repo 成功生成 Manifest（Python/Node 各 ≥1）。  
- `env_requirements` 与 `dependencies` 可从仓库自动提取，不允许空缺。  
- `example_code` ≤ 40 行，且包含 `ROOT_DIR` 协议。  

### 13.2 Dry Run 预演
- 对所有新入库技能执行 Dry Run（由 `skill_registry.ingest_repo` 触发异步任务）。  
- 失败即进入 `dry_run_fail`，连续失败达到阈值进入 `needs_review`。  
- 每次失败触发 Self‑Heal（最多 N=2 次/技能）。  
- 仅 `active` 状态技能进入 Qdrant 检索。  

### 13.3 检索与装配
- 输入 3 条不同意图，能在 Top-K 内命中对应 Skill。  
- JIT 装配可成功注入 `usage_spec` 并执行脚本。  
- `workspace_protocol` 强制生效（禁止绝对路径）。  

### 13.4 反馈与治理
- 记录 `success_rate` 与连续失败次数。  
- 连续失败 ≥ N 自动下线并告警。  
- `needs_review` 流程在管理员 UI 可追踪。  

## 14. API Mapping（Admin）
- `POST /api/v1/admin/skills`：创建技能（SkillRegistryCreate）  
- `GET /api/v1/admin/skills`：列表（分页: skip/limit）  
- `GET /api/v1/admin/skills/{skill_id}`：详情  
- `PATCH /api/v1/admin/skills/{skill_id}`：更新状态/名称  
- `POST /api/v1/admin/skills/{skill_id}/self-heal`：触发自愈  
> 权限：复用 `assistant.manage`

## 15. RepoIngestionService 真解析（Phase B）
本阶段目标：在 **不接入 OpenSandbox** 的前提下，实现“Repo 克隆 → 索引 → 解析 → LLM 生成 Manifest → 落库”的完整闭环。

### 15.1 触发入口（仅 Agent/插件）
- 复用 `crawler` 插件新增 action（例如 `submit_repo_ingestion`）。  
- 插件只负责提交 Celery 任务并返回 `task_id`，不做解析逻辑。  
- 入口参数：`repo_url`、`revision`（默认 `main`）、`runtime_hint`（python/node）、`skill_id`（可选）、`capability_hint`（可选）。

### 15.2 Celery 异步任务
- 新增 Celery 任务 `skill_registry.repo_ingestion`（默认队列）。  
- 任务流程：  
  1) `clone_repo`（`git clone --depth 1`，禁 submodule）  
  2) `build_file_index`（目录索引）  
  3) `collect_evidence`（Python/Node Parser）  
  4) `llm_generate_manifest`（复用 `llm_service`）  
  5) `persist_manifest`（写 `skill_registry` + 关系表）  
- 成功/失败均返回结构化结果：`status/skill_id/error_reason`。

### 15.3 临时工作区与安全
- 解析只在 **临时目录隔离** 内执行。  
- 目录根路径由配置项 `SKILL_INGESTION_WORKDIR` 控制，默认 `/tmp/deeting/ingestion/`。  
- 强制只读解析：**不 import、不执行 setup.py**，仅 `read_text`/`ast.parse`。  
- 任务结束清理目录（成功或失败均清理）。

### 15.4 Python/Node 解析增强
- **PythonRepoParser**：读取 `pyproject.toml`/`requirements.txt`/`setup.py`，AST 提取类/函数签名与 Docstring 摘要。  
- **NodeRepoParser**：读取 `package.json`，提取 `bin/exports/scripts` 入口与 README 摘要。  
- 解析输出统一为 `EvidencePack`（含 `readme/dependencies/entrypoints/snippets/metadata`）。

### 15.5 LLM 生成 Manifest（复用 llm_service）
- 将 `EvidencePack` 按固定 Prompt 传给 `llm_service`，输出结构化 JSON Manifest。  
- 输出需满足 Manifest v1 最小字段：  
  - `description`、`capabilities`  
  - `io_schema.inputs/outputs`  
  - `usage_spec.entrypoint/entry_class`  
  - `usage_spec.example_code`（20-40 行）

### 15.6 落库与状态
- `manifest_json` 作为单一事实源写入 `skill_registry`。  
- `capabilities/dependencies/artifacts` 同步拆分到三张关系表。  
- 失败时标记 `status=needs_review`（或在 `manifest_json["_error"]` 记录原因）。  
- **不做 OpenSandbox 执行**，仅静态解析与入库。
