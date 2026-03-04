# 技能注册表（Admin）

- 前置条件：需要 `assistant.manage` 权限（Bearer Token），路由前缀 `/api/v1`。
- 字段清单（SkillRegistryDTO）：
  - `id`: 技能唯一标识（如 `core.tools.crawler`）
  - `name`: 技能名称
  - `type`: 资源类型（固定为 `SKILL`，建议只读）
  - `runtime`: 运行时类型（`python_library` / `node_library` / `opensandbox` / `backend_task`）
    - 兼容说明：`python_library`、`node_library` 当前会由后端统一映射到 `opensandbox` 执行。
  - `version`: 语义化版本号
  - `description`: 技能描述
  - `source_repo`: 源码仓库地址
  - `source_subdir`: 源码子目录
  - `source_revision`: 源码版本/提交
  - `risk_level`: 风险等级（`low` / `medium` / `high`）
  - `complexity_score`: 复杂度评分
  - `manifest_json`: 技能清单/Manifest（JSON 对象）
  - `env_requirements`: 运行环境依赖（JSON 对象）
  - `vector_id`: 向量索引 ID
  - `status`: 技能状态（`draft` / `active` / `disabled`）
  - `created_at`: 创建时间（ISO 8601）
  - `updated_at`: 更新时间（ISO 8601）

## 1. 创建技能
`POST /admin/skills`

**Request Body**
```json
{
  "id": "docx_editor",
  "name": "Docx Editor",
  "type": "SKILL",
  "runtime": "python_library",
  "version": "1.0.0",
  "description": "docx editor",
  "source_repo": "https://github.com/acme/docx-editor",
  "source_subdir": "skills/docx",
  "source_revision": "main",
  "risk_level": "low",
  "complexity_score": 0.72,
  "manifest_json": {
    "description": "docx editor",
    "entrypoint": "docx_editor:run"
  },
  "env_requirements": {
    "python_version": ">=3.11",
    "system_packages": ["libxml2", "libxslt1-dev"]
  },
  "vector_id": "vec_docx_editor_v1",
  "status": "draft"
}
```
请求字段：
- `id`（必填）：技能唯一标识
- `name`（必填）：技能名称
- `status`（可选）：技能状态，默认 `draft`
- `type`（可选）：资源类型，固定 `SKILL`（可省略）
- `runtime`、`version`、`description`（可选）
- `source_repo`、`source_subdir`、`source_revision`（可选）
- `risk_level`、`complexity_score`（可选）
- `manifest_json`、`env_requirements`（可选，默认 `{}`）
- `vector_id`（可选）

**Response**
```json
{
  "id": "docx_editor",
  "name": "Docx Editor",
  "type": "SKILL",
  "runtime": "python_library",
  "version": "1.0.0",
  "description": "docx editor",
  "source_repo": "https://github.com/acme/docx-editor",
  "source_subdir": "skills/docx",
  "source_revision": "main",
  "risk_level": "low",
  "complexity_score": 0.72,
  "manifest_json": {
    "description": "docx editor",
    "entrypoint": "docx_editor:run"
  },
  "env_requirements": {
    "python_version": ">=3.11",
    "system_packages": ["libxml2", "libxslt1-dev"]
  },
  "vector_id": "vec_docx_editor_v1",
  "status": "draft",
  "created_at": "2026-02-01T00:00:00Z",
  "updated_at": "2026-02-01T00:00:00Z"
}
```
响应字段：见上方字段清单（SkillRegistryDTO）。

## 2. 技能列表
`GET /admin/skills?skip=0&limit=50`

**Response**
```json
[
  {
    "id": "docx_editor",
    "name": "Docx Editor",
    "type": "SKILL",
    "runtime": "python_library",
    "version": "1.0.0",
    "description": "docx editor",
    "source_repo": "https://github.com/acme/docx-editor",
    "source_subdir": "skills/docx",
    "source_revision": "main",
    "risk_level": "low",
    "complexity_score": 0.72,
    "manifest_json": {
      "description": "docx editor",
      "entrypoint": "docx_editor:run"
    },
    "env_requirements": {
      "python_version": ">=3.11",
      "system_packages": ["libxml2", "libxslt1-dev"]
    },
    "vector_id": "vec_docx_editor_v1",
    "status": "draft",
    "created_at": "2026-02-01T00:00:00Z",
    "updated_at": "2026-02-01T00:00:00Z"
  }
]
```
响应字段：见上方字段清单（SkillRegistryDTO）。

## 3. 技能详情
`GET /admin/skills/{skill_id}`

**Response**
```json
{
  "id": "docx_editor",
  "name": "Docx Editor",
  "type": "SKILL",
  "runtime": "python_library",
  "version": "1.0.0",
  "description": "docx editor",
  "source_repo": "https://github.com/acme/docx-editor",
  "source_subdir": "skills/docx",
  "source_revision": "main",
  "risk_level": "low",
  "complexity_score": 0.72,
  "manifest_json": {
    "description": "docx editor",
    "entrypoint": "docx_editor:run"
  },
  "env_requirements": {
    "python_version": ">=3.11",
    "system_packages": ["libxml2", "libxslt1-dev"]
  },
  "vector_id": "vec_docx_editor_v1",
  "status": "draft",
  "created_at": "2026-02-01T00:00:00Z",
  "updated_at": "2026-02-01T00:00:00Z"
}
```
响应字段：见上方字段清单（SkillRegistryDTO）。

## 4. 更新技能
`PATCH /admin/skills/{skill_id}`

**Request Body**
```json
{
  "status": "active",
  "description": "Updated description",
  "version": "1.0.1",
  "risk_level": "medium",
  "manifest_json": {
    "description": "updated docx editor",
    "entrypoint": "docx_editor:run"
  },
  "env_requirements": {
    "python_version": ">=3.11",
    "system_packages": ["libxml2", "libxslt1-dev"]
  }
}
```
请求字段（均为可选）：`name`、`status`、`type`（固定 `SKILL`）、`runtime`、`version`、`description`、`source_repo`、`source_subdir`、`source_revision`、`risk_level`、`complexity_score`、`manifest_json`、`env_requirements`、`vector_id`。

**Response**
```json
{
  "id": "docx_editor",
  "name": "Docx Editor",
  "type": "SKILL",
  "runtime": "python_library",
  "version": "1.0.1",
  "description": "Updated description",
  "source_repo": "https://github.com/acme/docx-editor",
  "source_subdir": "skills/docx",
  "source_revision": "main",
  "risk_level": "medium",
  "complexity_score": 0.72,
  "manifest_json": {
    "description": "updated docx editor",
    "entrypoint": "docx_editor:run"
  },
  "env_requirements": {
    "python_version": ">=3.11",
    "system_packages": ["libxml2", "libxslt1-dev"]
  },
  "vector_id": "vec_docx_editor_v1",
  "status": "active",
  "created_at": "2026-02-01T00:00:00Z",
  "updated_at": "2026-02-01T00:00:00Z"
}
```
响应字段：见上方字段清单（SkillRegistryDTO）。

## 5. 触发自愈
`POST /admin/skills/{skill_id}/self-heal`

说明：触发一次自愈流程（会自动进行 Dry Run，最多 N=2 次/技能）。

**Request Body**
无需请求体。

**Response**
```json
{
  "request": {
    "skill_id": "docx_editor",
    "manifest_json": {},
    "logs": []
  },
  "response": {
    "status": "success",
    "summary": "update example_code",
    "patches": [
      {
        "path": "usage_spec.example_code",
        "action": "set",
        "value": "print('ok')"
      }
    ],
    "updated_manifest": {},
    "warnings": []
  }
}
```
字段说明：返回结构遵循 `SkillSelfHealResult`。
