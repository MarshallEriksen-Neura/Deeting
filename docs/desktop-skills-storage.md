# 桌面端 Skills 本地存储路径

桌面端（Tauri）在启动时会扫描多个本地目录来注册技能：**官方技能**、**Deeting 受管用户技能**，以及 **共享代理技能目录**。

> 源码入口：`deeting/src-tauri/src/modules/mcp/commands_parts/skill_registry.rs` → `resolve_local_skill_scan_targets()`

## 1. 官方技能（Official Skills）

| 环境 | 路径 | 说明 |
|------|------|------|
| 开发模式 | `packages/official-skills/` | 仓库源码目录，回退路径 |
| 生产打包 | `{resource_dir}/official-skills/` | Tauri resources 打包产物 |

- 数据库 source 前缀：`system_plugin`
- 打包配置见 `deeting/src-tauri/tauri.conf.json`：`"packages/official-skills/": "official-skills/"`
- 当前官方技能列表：`memory`、`crawler`、`ingestor`、`expert_network`、`monitor`、`provider_registry`、`skill_manager`、`weather-plugin`

## 2. Deeting 受管用户技能（Managed User Skills）

用户技能存放在 Tauri 的 `app_data_dir` 下的 `skills/` 子目录，应用标识为 `com.deeting.app`。

| 操作系统 | 路径 |
|----------|------|
| macOS | `~/Library/Application Support/com.deeting.app/skills/` |
| Windows | `C:\Users\{user}\AppData\Roaming\com.deeting.app\skills\` |
| Linux | `~/.local/share/com.deeting.app/skills/`（或 `$XDG_DATA_HOME/com.deeting.app/skills/`） |

- 数据库 source 前缀：`user_skill`
- 目录不存在时会自动创建
- 用户可通过 `install_skill_from_repo` 命令从 Git 仓库安装技能到此目录
- 卸载技能时只允许删除此目录下的内容（安全校验：`install_path.starts_with(managed_skills_root)`）

## 3. 共享代理技能目录（Shared Agent Skills）

桌面端还会扫描用户主目录下的共享代理技能目录，用来直接接入 `npx skills add` / OpenClaw 生态安装出来的技能包。

| 操作系统 | 路径 |
|----------|------|
| macOS | `~/.agents/skills/` |
| Windows | `C:\Users\{user}\.agents\skills\` |
| Linux | `~/.agents/skills/` |

- 这些技能会被当作本地用户技能注册和调用，但目录本身不由 Deeting 管理
- Deeting 不会把 skill 再复制到 `app_data_dir/skills/`
- 卸载这类技能需要回到外部生态自己移除，例如 `npx skills remove ...`

## 4. 技能运行时（Skill Runtime）

已安装技能的依赖环境（虚拟环境 / node_modules）存放在：

```
{app_data_dir}/skills/.runtime/{normalized_skill_id}/
```

即与用户技能同级的 `.runtime` 隐藏目录下，按 skill_id 隔离。

| 运行时类型 | 包管理器 | 依赖标识文件 |
|-----------|---------|-------------|
| Python | `uv` | `requirements.txt` |
| Node | `npm` | `package.json` |

运行时状态机：`needs_install` → `installing` → `ready` / `install_failed` / `needs_reinstall`

## 5. 技能清单文件（Manifest）

每个技能目录下需要包含 `deeting.json` 清单文件，示例：

```json
{
  "$schema": "../deeting-manifest-schema.json",
  "id": "official.skills.memory",
  "name": "Knowledge & Memory",
  "version": "1.0.0",
  "author": "Deeting Team",
  "description": "Manage long-term memory and knowledge base search.",
  "entry": {
    "backend": "main.py"
  },
  "runtime": ["cloud", "local"],
  "capabilities": {
    "llm_tools": "llm-tool.yaml"
  }
}
```

Schema 定义：`packages/deeting-manifest-schema.json`

## 6. 扫描与注册流程

```
App 启动
  └─ register_local_skills()
       └─ resolve_local_skill_scan_targets()
            ├─ official-skills 目录 (system_plugin)
            ├─ app_data_dir/skills 目录 (user_skill)
            └─ ~/.agents/skills 目录 (user_skill)
       └─ 遍历子目录
            ├─ 读取 deeting.json → 解析 manifest
            ├─ upsert_local_skill_install → 写入 SQLite
            ├─ collect_local_skill_tool_bindings → 注册工具绑定
            └─ index_local_skill_bundle_asset → 生成向量索引
```

## 7. 目录结构总览

```
{app_data_dir}/                              # Tauri app_data_dir
└── skills/
    ├── my-custom-skill/                     # 用户技能（user_skill）
    │   ├── deeting.json                     # 技能清单
    │   ├── main.py                          # 入口文件
    │   ├── requirements.txt                 # Python 依赖
    │   └── llm-tool.yaml                    # 工具声明
    └── .runtime/                            # 运行时隔离目录
        └── my-custom-skill/                 # 按 skill_id 隔离
            └── .venv/                       # Python 虚拟环境（uv 管理）

{home_dir}/
└── .agents/
    └── skills/
        └── find-skills/                     # 共享代理技能，Deeting 会直接扫描
            ├── SKILL.md
            └── scripts/...

{resource_dir}/                              # Tauri resource_dir（打包产物）
└── official-skills/
    ├── memory/                              # 官方技能
    │   ├── deeting.json
    │   └── main.py
    ├── crawler/
    ├── skill_manager/
    └── ...
```
