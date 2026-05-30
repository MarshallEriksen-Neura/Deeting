# Deeting 架构全景梳理与不足分析 (v2 · 对抗验证版)

> 生成日期: 2026-05-29
> 版本: v2 — 经红蓝对抗验证，修正了 v1 中 7 个错误结论
> 覆盖范围: deeting/, deeting_core/, deeting-relay/, packages/, installer/
> 数据来源: CodeGraph (37998 nodes, 89688 edges), 文件系统扫描, 架构文档审阅, 红蓝对抗代码验证
> 验证方法: Red Team (10 项质疑) + Blue Team (15 项验证/新发现)

---

## 目录

1. [全局概览](#1-全局概览)
2. [分块架构详解](#2-分块架构详解)
   - 2.1 前端层 (Next.js + React 19)
   - 2.2 Tauri/Rust 运行时
   - 2.3 后端核心 (deeting_core)
   - 2.4 MCP 子系统
   - 2.5 插件/技能/SDK 生态
   - 2.6 IM Relay
   - 2.7 安装器
3. [数据流与交互拓扑](#3-数据流与交互拓扑)
4. [不足与风险分析](#4-不足与风险分析)
   - 4.1 🔴 高风险 (代码级)
   - 4.2 🟠 高风险 (架构级)
   - 4.3 🟡 中等风险
   - 4.4 🟢 低风险 / 设计偏好
5. [红蓝对抗验证记录](#5-红蓝对抗验证记录)
6. [改进建议](#6-改进建议)
7. [附录: 架构亮点](#附录-架构亮点)

---

## 1. 全局概览

### 1.1 项目规模

| 指标 | 数值 | 验证状态 |
|------|------|----------|
| 总文件数 | 2,405 | ✅ CodeGraph |
| CodeGraph 节点 | 37,998 | ✅ CodeGraph |
| CodeGraph 边 | 89,688 | ✅ CodeGraph |
| Rust 源文件 (modules/) | ~400 | ✅ find |
| Python 源文件 (deeting_core/) | ~539 | ✅ find |
| 前端组件文件 (.tsx/.ts) | ~268 | ✅ find |
| Rust 模块目录 | **39** | ✅ find (v1 写 "40+", 实际 39) |
| 后端服务目录 | 40+ | ✅ find |
| 后端数据模型 | **47** (不含 __init__/base) | ✅ find (v1 写 49, 含了非模型文件) |
| 后端 API 路由文件 | **54** | ✅ find (v1 写 26, 遗漏了 admin/internal 路由) |
| 架构文档 | 22 篇 | ✅ find |
| 前端依赖 | 73 (prod) + 15 (dev) | ✅ package.json |
| Tauri workspace crates | 8 | ✅ Cargo.toml |
| Rust 内联测试标记 | **1,344** (分布在 202 个文件) | ✅ grep `#[test]` (v1 错误地写 "1 个测试文件") |

### 1.2 技术栈全景

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Deeting OS 技术栈                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  前端:  Next.js 16 + React 19 + TypeScript + Tailwind + Shadcn UI      │
│  状态:  Zustand (21 stores) + SWR                                       │
│  国际化: next-intl ([locale] 路由) + middleware.ts                      │
│  构建:  Bun + Turbopack                                                 │
│                                                                         │
│  桌面:  Tauri 2 + Rust 1.77+                                            │
│  沙箱:  BoxLite (sidecar 进程)                                          │
│  MCP:   7 个独立 crate (5 个有合理边界, 2 个可合并)                     │
│                                                                         │
│  后端:  Python (FastAPI) + SQLAlchemy + Alembic                         │
│  向量:  Qdrant                                                          │
│  搜索:  MeiliSearch                                                     │
│  缓存:  Redis                                                           │
│                                                                         │
│  Relay: Go (飞书/Telegram/WeChat Webhook → WebSocket)                   │
│  安装器: Tauri 2 + Next.js                                              │
│  SDK:   packages/deeting-sdk                                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.3 架构分层总览

```
┌─────────────────────────────────────────────────────────────────────┐
│  接入面 (Ingress Surface)                                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ 主窗口   │ │ Island   │ │ IM Relay │ │ Chrome   │ │ 划词助手 │ │
│  │ Chat UI  │ │ 灵动岛   │ │ 飞书/TG  │ │ 扩展     │ │          │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │
├───────┼────────────┼────────────┼────────────┼────────────┼────────┤
│       └────────────┴────────────┴────────────┴────────────┘        │
│                              │                                      │
│                        Tauri IPC / HTTP                              │
│                              │                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  桌面运行时 (Rust)                                             │  │
│  │  LocalOrchestrationEngine → ExecutionPlane → ToolCatalog       │  │
│  │  ContextOrchestrator → RetrievalKernel                         │  │
│  │  Skills / MCP / Sandbox / Providers / Workflow                 │  │
│  │  Memory / Knowledge / LLM Wiki / Terminal / Voice              │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│                        HTTP API                                      │
│                              │                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  云端 (deeting_core - Python)                                  │  │
│  │  Auth / Billing / Knowledge / Memory / Vector / Search         │  │
│  │  Agent Plugins / Spec Agent / Workflow / Monitoring            │  │
│  │  Protocol Layer (OpenAI/Anthropic ingress/egress)              │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 分块架构详解

### 2.1 前端层 (deeting/)

#### 2.1.1 页面路由结构

```
app/[locale]/                           # i18n 国际化路由 (next-intl)
├── chat/                               # 主聊天工作台 (核心页面)
│   ├── @assistant/                     # 并行路由 - 助手面板
│   ├── @canvas/                        # 并行路由 - Canvas 面板
│   ├── @controls/                      # 并行路由 - 控制面板
│   ├── @hud/                           # 并行路由 - HUD 面板
│   ├── @workspace/                     # 并行路由 - 工作空间面板
│   ├── [agentId]/                      # 动态路由 - 特定 Agent
│   └── select-agent/                   # Agent 选择页
├── knowledge/                          # 本地知识库 (8 个专用组件)
├── memory/                             # 长期记忆
├── llm-wiki/                           # 语义 Wiki (6 个专用组件)
├── skills/                             # 技能管理
├── mcp/                                # MCP Server 管理
├── models/                             # 模型配置
├── settings/                           # 设置
├── island/                             # 灵动岛 (独立窗口)
├── dashboard/                          # 仪表盘
│   ├── bandit/                         # Bandit 策略面板
│   ├── ecosystem/                      # 生态面板
│   ├── knowledge/                      # 知识管理
│   ├── llm-wiki/                       # Wiki 管理
│   ├── logs/                           # 日志
│   ├── memory/                         # 记忆管理
│   ├── monitoring/                     # 监控
│   ├── monitors/                       # 监视器
│   ├── images/                         # 图像管理
│   ├── notification-channels/          # 通知渠道
│   ├── task-learning/                  # 任务学习
│   └── approval-rules/                 # 审批规则
├── agents/                             # Agent 管理
│   └── task-agents/                    # 任务 Agent
├── admin/                              # 管理后台
│   └── users/                          # 用户管理
├── login/                              # 登录
├── scan-reviews/                       # 扫描审核
└── workflow/                           # 工作流
```

**亮点**: 使用 Next.js 并行路由 (`@assistant`, `@canvas`, `@controls`, `@hud`, `@workspace`) 实现聊天页面的多面板布局，这是高级 Next.js 用法。

#### 2.1.2 组件架构 (268 文件)

```
components/
├── chat/                    # 聊天核心组件
├── island/                  # 灵动岛组件
├── bridge/                  # 浏览器桥接组件
├── workspace/               # 工作空间组件
├── terminal/                # 终端组件
├── knowledge/               # 知识库组件
├── mcp/                     # MCP 管理组件
├── models/                  # 模型配置组件
├── plugins/                 # 插件组件
├── workflow/                # 工作流组件
├── dashboard/               # 仪表盘组件
├── providers/               # Provider 组件
├── audio/                   # 音频组件
├── image/                   # 图像组件
├── auth/                    # 认证组件
├── admin/                   # 管理组件
├── notifications/           # 通知组件
├── layout/                  # 布局组件
├── common/                  # 通用组件
├── contexts/                # React Context (仅 1 个: notification-context.tsx)
├── inspection/              # 页面检查面板 (1 个文件)
├── views/                   # 视图组件
├── ui/                      # Shadcn UI 基础组件
└── providers/               # 全局 Provider
```

**观察**: 仅 1 个 React Context 文件，说明应用以 Zustand 为主，Context 使用极少 — 这是干净的模式。

#### 2.1.3 状态管理 (Zustand - 21 个 Store)

| Store | 符号数 | 职责 |
|-------|--------|------|
| `chat-store.ts` | 41 | 聊天状态 (最大) |
| `spec-agent-store.ts` | 30 | Spec Agent 状态 |
| `notification-store.ts` | 20 | 通知状态 |
| `workspace-store.ts` | 16 | 工作空间 |
| `workflow-store.ts` | 15 | 工作流 |
| `browser-mode-store.ts` | 13 | 浏览器模式 |
| `chat-runtime-store.ts` | 13 | 聊天运行时 |
| `theme-store.ts` | 11 | 主题 |
| `language-store.ts` | 11 | 语言 |
| `user-store.ts` | 11 | 用户 |
| `terminal-panel-store.ts` | 11 | 终端面板 |
| `capability-settings-store.ts` | 10 | 能力设置 |
| `video-generation-store.ts` | 10 | 视频生成 |
| `market-store.ts` | 9 | 市场 |
| `auth-store.ts` | 11 | 认证 |
| `artifact-store.ts` | 7 | 产物 |
| `desktop-auth-bootstrap-store.ts` | 6 | 桌面认证引导 |
| `modal-store.ts` | 5 | 弹窗 |
| `api-key-drawer-store.ts` | 5 | API Key 抽屉 |
| `interface-transition-store.ts` | 5 | 界面过渡 |
| `persist-storage.ts` | 4 | 持久化存储 |

> **[红队验证]** 小 store 合并建议缺乏证据。21 个 store 不是问题本身，需要证明耦合才能建议合并。Zustand store 创建成本极低。

#### 2.1.4 Hooks 层 (26 个)

| Hook | 符号数 | 职责 |
|------|--------|------|
| `use-providers.ts` | 42 | Provider 管理 (最大) |
| `use-auth.ts` | 21 | 认证 |
| `use-login-form.ts` | 16 | 登录表单 |
| `use-api-keys.ts` | 14 | API Key 管理 |
| `use-chat-models.ts` | 12 | 聊天模型 |
| `use-update-checker.ts` | 12 | 更新检查 |
| 其他 20 个 hooks | 3-11 | 各种工具 hooks |

#### 2.1.5 工具库 (lib/)

```
lib/
├── ai/                    # AI/LLM 集成 (仅 1 文件: capability-settings.ts)
├── api/                   # API 调用封装
├── auth/                  # 认证工具
├── browser/               # 浏览器工具
├── chat/                  # 聊天工具
├── execution-tree/        # 执行树前端类型 (2 文件: actions.ts, types.ts)
├── gateway-log/           # 网关日志
├── http/                  # HTTP 客户端
├── mcp/                   # MCP 工具
├── platform/              # 平台检测
├── plugins/               # 插件工具
├── providers/             # Provider 工具
├── render-runtime/        # 浏览器事件总线 (3 文件: CustomEvent pub/sub)
├── runtime/               # 运行时工具
├── swr/                   # SWR 数据获取
├── utils/                 # 通用工具
└── workflow/              # 工作流工具
```

> **[红队验证]** `lib/render-runtime/` 不是 Rust `modules/render_runtime/` 的重复 — 前端是浏览器 CustomEvent pub/sub，Rust 是 Handlebars 模板渲染。二者是互补的半边。

#### 2.1.6 前端代码质量指标 (Blue Team 新发现)

| 指标 | 数值 | 评估 |
|------|------|------|
| `: any` 类型 | 27 处 / 10 文件 | 🟢 10% 命中率，对 268 文件的代码库很干净 |
| `@ts-ignore` / `@ts-expect-error` | 6 处 / 3 文件 | 🟢 极少 |
| `eslint-disable` | 1 处 | 🟢 极少 |
| TODO/FIXME | 2 处 / 1 文件 | 🟢 极少 |

---

### 2.2 Tauri/Rust 运行时

#### 2.2.1 Workspace Crates (8 个)

| Crate | 外部依赖 | 内部依赖 | 边界合理性 |
|-------|----------|----------|-----------|
| `desktop-runtime-core` | - | - | ✅ 核心库 |
| `mcp-core` | 5 (serde, sqlx, thiserror, time, serde_json) | 0 | ✅ 纯类型层 |
| `mcp-facade` | 7 (reqwest, sha2, hex, tokio...) | mcp-core | ✅ HTTP 门面 |
| `mcp-registry` | 2 (serde, serde_json) | 0 | ⚠️ 极薄，可合并到 mcp-core |
| `mcp-runtime` | 5 | desktop-runtime-core + mcp-core | ✅ 运行时隔离 |
| `mcp-session` | 3 (mcp-core, serde, serde_json) | mcp-core | ⚠️ 极薄，可合并到 mcp-core |
| `mcp-storage` | 6 (sha2, hex, time...) | mcp-core | ✅ 持久化隔离 |
| `mcp-transport` | 8 (reqwest, rmcp, tauri, tokio...) | mcp-core | ✅ **必须隔离** (tauri+进程管理) |

> **[红队验证]** 7 个 crate 中 5 个有明确的依赖隔离理由。`mcp-transport` 必须独立 (tauri + rmcp + tokio 进程管理)。仅 `mcp-registry` 和 `mcp-session` 可考虑合并。v1 的 "过度工程化" 结论过于笼统。

另有 2 个非 workspace crate:
- `boxlite-sidecar-protocol`: BoxLite 沙箱 sidecar 协议
- `deeting-boxlite-sidecar`: BoxLite sidecar 进程

#### 2.2.2 Rust 模块 (39 个目录)

**对话与编排 (核心)**:
```
desktop_runtime/
├── context_orchestrator/     # 上下文编排 (RAG)
├── local_orchestrator/       # 本地编排流水线
└── runtime/                  # 运行时核心
    ├── execution_plane/      # 执行编排 (Composition-based)
    │   ├── composition/      # 阶段步骤编排
    │   └── delegation/       # 委托执行 (Workflow/Agent)
    ├── execution_graph/      # DAG 执行图
    ├── task_learning/        # TaskFingerprint, PolicyDelta
    ├── posterior_signal/     # 用户后验信号
    ├── evolution/            # 自进化核心
    └── sovereign/            # Sovereign 架构
```

**知识与记忆**:
```
memory/                       # 长期记忆, Write Guard, Fact Extractor
knowledge/                    # 本地知识库, FTS5 + 语义检索
llm_wiki/                     # 语义 Wiki, Corpus 管理
retrieval_kernel/             # 生命周期衰减, Supersession, Ranking
```

**扩展与工具**:
```
skills/                       # 技能注册表 (发现、安装、能力声明)
skill_runtime/                # 技能执行引擎 (Python/Node 子进程管理) [红队验证: 与 skills/ 是合理分层]
mcp/                          # MCP Server 管理
terminal/                     # 终端上下文捕获
sandbox/                      # 代码执行沙箱 (BoxLite)
```

**模型与路由**:
```
providers/                    # 模型 Provider 配置
ai_upstream/                  # 上游 AI 服务
ai_access/                    # AI 访问控制
```

**IM 与通信**:
```
im/                           # IM 消息处理
  ├── feishu/                 # 飞书集成
  ├── telegram/               # Telegram 集成
  └── wechat/                 # 微信集成
relay/                        # Relay 客户端
```

**对话管理** (v1 标记为 "重复"，红队已驳回):
```
conversation/                 # IM 面向的薄服务层 (供 im/ 和 Island 复用)
conversations/                # 持久化/摘要/事实抽取基础设施
```

> **[红队验证]** 这是合理的分层: `conversation/` 被 `im/handlers.rs` 等调用，`conversations/` 被 `desktop_runtime`、`assistants`、`mcp`、`llm_wiki` 等调用。无文件同时导入两者。问题是命名 (单数/复数容易混淆)，不是职责重叠。

**语音相关** (v1 标记为 "重叠"，红队已驳回):
```
voice/                        # TTS Provider 驱动 (volcengine, openai, minimax)
  └── tts/                    # TTS 后端实现
audio/                        # 音频结果块渲染和存储 (聊天中的音频展示)
voice_capabilities/           # STT (语音转文字) 和 TTS 能力声明
```

> **[红队验证]** 三个模块职责完全不同: TTS 后端集成 / 音频 UI 渲染 / 语音能力声明。仅 `voice/tts/` 与 `voice_capabilities/tts.rs` 有轻微重叠 (实现 vs 声明)。

**渲染运行时** (v1 标记为 "重复"，红队已驳回):
```
前端 lib/render-runtime/     # 浏览器 CustomEvent pub/sub (3 文件)
Rust modules/render_runtime/ # Handlebars 模板渲染 + HTML 快照 + SQLite 缓存 (6 文件)
```

> **[红队验证]** 互补系统，非重复。Rust 生成 HTML 快照，前端提供浏览器事件协调。通过 Tauri IPC 通信。

**其他模块**:
```
workflow/                     # 工作流引擎
image_generation/             # 图像生成
browser_agent/                # 浏览器 Agent
island_window/                # Island 灵动岛窗口
selection_assistant/          # 划词助手
code_mode/                    # Code Mode
chat_assets/                  # 聊天资产
asset_registry/               # 资产注册
external_sources/             # 外部源
custom_task_agents/           # 自定义任务 Agent
capability_control_plane/     # 能力控制面
desktop_config/               # 桌面配置
monitor/                      # 监控
scan/                         # 扫描
rag_eval/                     # RAG 评测
generated_files/              # 文档生成
admin/                        # 管理
```

#### 2.2.3 Rust 测试覆盖 (v1 严重错误修正)

> ⚠️ **v1 错误**: 声称 "Rust 测试覆盖 0.25%，400 个文件仅 1 个测试文件"。
> **实际**: 通过 grep `#[cfg(test)]` 和 `#[test]` 发现 **1,344 个测试标记分布在 202 个文件中**。
> v1 的错误方法论: 按文件名 (`*test*`) 计数，忽略了 Rust 惯用的内联测试模式。

| 指标 | v1 (错误) | v2 (验证后) |
|------|-----------|-------------|
| 测试文件 | 1 | **202** (含内联 `#[cfg(test)]`) |
| 测试标记 | 未知 | **1,344** (`#[test]` + `#[cfg(test)]`) |
| 覆盖率估算 | 0.25% | **~50%** |

关键测试浓度 (Top 10):

| 模块/文件 | 测试标记数 |
|-----------|-----------|
| `chat_tool_runtime/tests.rs` | 51 |
| `providers/request_runtime.rs` | 39 |
| `local_orchestrator/tests.rs` | 41 |
| `context_orchestrator/tests.rs` | 31 |
| `mcp/commands/runtime/capability_catalog.rs` | 31 |
| `capability_discovery.rs` | 26 |
| `evolution/service.rs` | 26 |
| `code_mode/core_tool_contracts.rs` | 24 |
| `skills/registry_impl.rs` | 20 |
| `memory/fact_extractor.rs` | 17 |

#### 2.2.4 执行策略 (Composition-based)

```
ExecutionStrategy (执行策略):
  DirectIteration     → DirectChat 阶段 (直接对话迭代)
  DelegatedWorkflow   → DelegatedWorkflow 阶段 (委托给工作流)
  DelegatedAgent      → DelegatedWorker 阶段 (委托给 Agent)
  Hybrid              → 根据 policy 回退

PhaseStepType (阶段步骤):
  DirectChat          直接对话
  ToolCall            工具调用
  DelegatedWorker     委托给 Worker Agent
  DelegatedWorkflow   委托给 Workflow 引擎
  CapabilityAdmit     能力准入
  VerifyFinal         最终验证
```

---

### 2.3 后端核心 (deeting_core)

#### 2.3.1 服务层 (40+ 个服务目录)

**核心业务**:
| 服务 | 职责 |
|------|------|
| `assistant/` | Assistant 管理 (14 个文件) |
| `conversation/` | 对话管理 |
| `agent/` | Agent 服务 |
| `orchestrator/` | 编排器 |
| `runtime/` | 运行时服务 |
| `workflow/` | 工作流 |

**知识与记忆**:
| 服务 | 职责 |
|------|------|
| `knowledge/` | 知识库 |
| `memory/` | 记忆系统 |
| `indexing/` | 索引服务 |
| `vector/` | 向量服务 (Qdrant) |
| `search/` | 搜索服务 (MeiliSearch) |

**扩展与集成**:
| 服务 | 职责 |
|------|------|
| `mcp/` | MCP 服务 |
| `mcp_bridge/` | MCP 桥接 |
| `skill_registry/` | 技能注册 |
| `tools/` | 工具服务 |
| `providers/` | Provider 管理 |
| `routing/` | 路由服务 |

**运营与管理**:
| 服务 | 职责 |
|------|------|
| `admin/` | 管理服务 (8 个文件) |
| `billing_pipeline/` | 计费流水线 |
| `credits/` | 积分系统 |
| `payments/` | 支付 |
| `monitoring/` | 监控 |
| `notifications/` | 通知 |
| `dashboard/` | 仪表盘 |
| `feedback/` | 反馈 |
| `review/` | 审核 |
| `secretary/` | 秘书服务 |
| `secrets/` | 密钥管理 |
| `system/` | 系统服务 |
| `system_assets/` | 系统资产 |
| `users/` | 用户服务 |
| `oss/` | 对象存储 |
| `captcha/` | 验证码 |
| `decision/` | 决策服务 |
| `image_generation/` | 图像生成 |
| `video_generation/` | 视频生成 |
| `code_mode/` | Code Mode (5 个文件) |

#### 2.3.2 数据模型 (47 个数据模型)

| 模型分类 | 模型文件 |
|----------|----------|
| **用户与认证** | user, identity, login_session, desktop_browser_login, desktop_oauth, registration_window, invite_code, **api_key** (v1 遗漏) |
| **Assistant** | assistant, assistant_install, assistant_rating, assistant_routing, assistant_tag |
| **对话** | conversation, gateway_log |
| **知识** | knowledge, knowledge_folder, spec_knowledge |
| **记忆** | memory_snapshot |
| **技能** | skill_artifact, skill_capability, skill_dependency, skill_registry |
| **MCP** | mcp_market, user_mcp_server, user_mcp_source |
| **Provider** | provider_instance, provider_preset, upstream_secret |
| **计费** | billing, bridge_agent_token |
| **Agent** | agent_plugin, spec_agent, code_mode_execution |
| **媒体** | media_asset, image_generation, video_generation, user_document |
| **通知** | notification, user_notification_channel |
| **监控** | monitor, trace_feedback, system_setting, system_asset |
| **其他** | secretary, review, bandit |

> 总计 49 文件，其中 47 个数据模型 + `__init__.py` + `base.py`。

#### 2.3.3 API 路由层 (54 个路由文件)

> ⚠️ **v1 错误**: 声称 "26 个 API 路由文件"，实际遗漏了 admin 和 internal 路由。

| 路由分层 | 文件数 | 路径 |
|----------|--------|------|
| v1 公开路由 | 25 | `api/v1/*_route.py` |
| v1 admin 路由 | ~22 | `api/v1/admin/*_route.py` |
| v1 internal 路由 | ~7 | `api/v1/internal/*_route.py` |
| 根级路由 | 1 | `api/metrics_route.py` |
| operations 路由 | 1 | `api/operations/user_document_router.py` |
| **总计** | **~54** | |

#### 2.3.4 协议层 (24 个文件)

```
protocols/
├── canonical/               # 规范模型
├── contracts/               # 契约定义
├── ingress/                 # 入口协议 (客户端 → Core)
│   ├── anthropic_messages.py
│   ├── chat_completions.py
│   └── responses.py
├── egress/                  # 出口协议 (Core → 上游)
├── profiles/                # 协议 Profile (openai_chat, openai_responses, anthropic_messages)
└── runtime/                 # 运行时 (profile_resolver, request_builder, stream_decoders, transport_executor)
```

**亮点**: 协议层设计成熟 — 支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 三种协议的 ingress/egress 双向转换。

#### 2.3.5 Agent 插件系统

```
agent_plugins/
├── core/
│   ├── context.py           # 插件上下文
│   ├── interfaces.py        # 插件接口定义
│   └── manager.py           # 插件管理器
└── examples/
    └── hello_world.py       # 示例插件
```

---

### 2.4 MCP 子系统

MCP (Model Context Protocol) 由 **7 个 Rust crate** 组成:

```
┌─────────────────────────────────────────────────────────────────┐
│                    MCP 子系统架构                                 │
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                   │
│  │ mcp-core │◄───│mcp-facade│◄───│ 前端/UI  │                   │
│  │ 协议类型 │    │ 门面层   │    │          │                   │
│  └────┬─────┘    └──────────┘    └──────────┘                   │
│       │                                                          │
│  ┌────▼─────┐    ┌──────────┐    ┌──────────┐                   │
│  │mcp-      │───►│mcp-      │───►│mcp-      │                   │
│  │registry  │    │runtime   │    │session   │                   │
│  │注册表    │    │运行时    │    │会话管理  │                   │
│  └──────────┘    └────┬─────┘    └──────────┘                   │
│                       │                                          │
│                  ┌────▼─────┐    ┌──────────┐                   │
│                  │mcp-      │───►│mcp-      │                   │
│                  │transport │    │storage   │                   │
│                  │传输层    │    │持久化    │                   │
│                  └──────────┘    └──────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

> **[红队验证]** 5/7 crate 有明确的依赖隔离理由。仅 `mcp-registry` (2 外部依赖, 0 内部依赖) 和 `mcp-session` (3 依赖, 极薄) 可考虑合并到 `mcp-core`。建议: 7 → 5 crates，而非 v1 的 "合并到 2-3 个"。

---

### 2.5 插件/技能/SDK 生态

```
packages/
├── deeting-sdk/             # Deeting SDK (对外暴露)
├── official-skills/         # 官方技能包
├── create-deeting-plugin/   # 插件脚手架工具
└── templates/               # 模板
```

---

### 2.6 IM Relay (Go)

```
deeting-relay/
├── main.go                  # 1,254 行, 88 symbols - 主入口
└── main_test.go             # 10 symbols - 测试
```

**功能清单** (v1 评估不完整，红队已修正):

| 功能 | 状态 | 证据 |
|------|------|------|
| 配置管理 | ✅ 存在 | `RelayConfig` 结构体，从环境变量加载 (v1 错误地声称 "缺少") |
| Webhook 签名验证 | ✅ 存在 | `verifyFeishuSignature` (813-866 行)，含重放保护 |
| Agent 认证 | ✅ 存在 | `requireAgentAuth` 中间件 (469-487 行)，HMAC 比较 |
| 消息去重 | ✅ 存在 | `RememberMessage` / `RememberCallback`，TTL 过期 |
| 优雅关闭 | ❌ 缺失 | 使用裸 `http.ListenAndServe`，无信号处理 |
| 健康检查端点 | ❌ 缺失 | 无 `/health` 或 `/ready` 路由 |
| 可观测性 | ❌ 缺失 | 无 metrics, 无结构化日志, 无 tracing |

---

### 2.7 安装器

```
installer/
├── app/                     # Next.js 页面
├── components/              # 安装器组件
└── src-tauri/               # Tauri 后端
```

---

## 3. 数据流与交互拓扑

### 3.1 本地对话流程

```
用户输入
    │
    ▼
┌───────────────────────────────────────────────────────────────────┐
│ LocalOrchestrationEngine (Rust)                                    │
│                                                                    │
│  1. SummaryInjectionStep        注入会话摘要                      │
│  2. PersonaPromptInjectionStep  注入人格 Prompt                   │
│  3. ContextManifestStep         注入上下文清单 (不注入正文)       │
│  4. RouteSelectionStep          路由选择 (含 Bandit + Prior)      │
│  5. SkillRecipeInjectionStep    注入技能配方                      │
│  6. TemplateRenderStep          渲染最终 Prompt                   │
└───────────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────────┐
│ chat_tool_runtime (Agentic Loop)                                   │
│                                                                    │
│  每轮:                                                             │
│    1. 调用 LLM Provider (Rust → HTTP → deeting_core / 直连)       │
│    2. 解析 tool_calls                                              │
│    3. 执行工具 (context_* / skill / MCP / shell / sandbox)        │
│    4. 结果写回 orchestrated_messages                               │
│    5. 继续下一轮或 finalize                                        │
└───────────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────────┐
│ 后处理                                                             │
│  - Fact Extractor: 抽取长期事实写入 Memory                        │
│  - Task Learning: 评估任务结果，更新先验                          │
│  - Execution Graph: 持久化 DAG 到 SQLite                          │
│  - Posterior Signal: 用户后验信号处理                             │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 IM 触达流程

```
飞书/Telegram/WeChat 用户发送消息
    │
    ▼
┌───────────────────────────────────────────────────────────────────┐
│ deeting-relay (Go)                                                 │
│  1. 验证 Webhook 签名 (含重放保护)                                │
│  2. 解析消息内容                                                   │
│  3. 存入消息队列 (含去重)                                         │
│  4. 等待桌面端拉取                                                 │
└───────────────────────────────────────────────────────────────────┘
    │
    │ WebSocket / Long Polling
    ▼
┌───────────────────────────────────────────────────────────────────┐
│ 桌面端 modules/im/ + modules/relay/                                │
│  1. 拉取 IM 消息                                                   │
│  2. 进入本地对话流程 (通过 conversation/ 薄服务层)                │
│  3. 执行工具、调用模型                                             │
│  4. 结果通过 relay 回传 IM                                         │
└───────────────────────────────────────────────────────────────────┘
```

### 3.3 前端 ↔ Rust ↔ Core 通信

```
┌──────────────┐     Tauri IPC      ┌──────────────┐     HTTP API     ┌──────────────┐
│   Next.js    │ ◄────────────────► │    Rust      │ ◄────────────► │   deeting    │
│   Frontend   │   invoke/event     │   Runtime    │   reqwest      │   _core      │
│              │                    │              │                │              │
│  Zustand     │                    │  modules/*   │                │  services/*  │
│  SWR         │                    │  commands.rs │                │  api/v1/*    │
│  hooks/      │                    │  state.rs    │                │  protocols/  │
└──────────────┘                    └──────────────┘                └──────────────┘
```

---

## 4. 不足与风险分析

### 4.1 🔴 高风险 (代码级) — Blue Team 新发现

#### 4.1.1 生产代码中的 `unwrap()` 调用 ⚠️ 高危

**34 个 `unwrap()` 调用分布在 20 个 Rust 文件中**，可导致运行时 panic (崩溃)。

| 模块 | unwrap 数 | 风险等级 | 说明 |
|------|-----------|----------|------|
| `memory/fact_extractor.rs` | **6** | 🔴 **极高** | 每次对话后运行，panic 会中断记忆抽取 |
| `desktop_config/network.rs` | 3 | 🟠 高 | 网络配置 |
| `im/mod.rs` | 2 | 🔴 **极高** | IM 集成，panic 会中断 relay 桥接 |
| `im/feishu/client.rs` | 2 | 🔴 **极高** | 飞书集成 |
| `sandbox/installer.rs` | 2 | 🟠 高 | 沙箱安装 |
| `sandbox/manager.rs` | 2 | 🟠 高 | 沙箱管理 |
| `selection_assistant/capture.rs` | 1 | 🟡 中 | 划词助手 |
| `island_window.rs` | 1 | 🟡 中 | 灵动岛 |
| `tray.rs` | 1 | 🟡 中 | 系统托盘 |

**建议**: 优先处理 `memory/fact_extractor.rs` (6 处) 和 `im/` (4 处) — 这两个模块在核心路径上，panic 会直接影响用户体验。

#### 4.1.2 技术债务标记 (deprecated/legacy/workaround)

**422 个标记分布在 121 个文件中** — 这是 v1 完全遗漏的重大发现。

Top 10 重灾区:

| 文件 | 标记数 | 模块 |
|------|--------|------|
| `mcp-transport/src/remote.rs` | 27 | MCP 传输层 |
| `composition/mod.rs` | 27 | 执行编排 |
| `skills/registry_impl.rs` | 26 | 技能注册 |
| `capability_discovery.rs` | 11 | 能力发现 |
| `admin/commands.rs` | 10 | 管理命令 |
| `providers/store/tests.rs` | 9 | Provider 测试 |
| `skill_registry/runtimes/sandbox.py` | 9 | 后端技能沙箱 |
| `memory/qdrant_collection_migration_service.py` | 7 | Qdrant 迁移 |
| `20260308_01_drop_provider_preset_legacy_columns.py` | 5 | 数据库迁移 |

**建议**: 分层处理 — (a) 真正的临时变通方案需解决, (b) 向后兼容的 "legacy" 命名可接受, (c) 废弃代码路径需清理。

#### 4.1.3 `unsafe` 代码块

**9 个 `unsafe` 块分布在 3 个文件中**:

| 文件 | unsafe 数 | 说明 |
|------|-----------|------|
| `selection_assistant/capture.rs` | 7 | 屏幕捕获 (FFI 到 OS API，预期行为) |
| `custom_task_agents/bound_callables.rs` | 1 | 需审查 |
| `mcp/commands_parts/tests.rs` | 1 | 测试代码 |

**评估**: `capture.rs` 的 7 个 unsafe 对屏幕捕获 FFI 是正常的，但 `bound_callables.rs` 的 unsafe 需要安全审查。

#### 4.1.4 死代码注解 (`#[allow(dead_code)]`)

**19 个文件** 包含死代码抑制:

| 模块 | 文件数 | 最严重 |
|------|--------|--------|
| `sandbox/` | 5 | `manager.rs` (5 处) |
| `llm_wiki/` | 5 | `automation.rs` (5 个未使用状态常量) |
| `desktop_runtime/` | 6 | `runtime_event_projection/mod.rs` (4 处) |
| `retrieval_kernel/` | 4 | `lifecycle.rs` (4 处) |

**评估**: 中等风险。可能是未完成的功能或废弃的代码路径。

---

### 4.2 🟠 高风险 (架构级)

#### 4.2.1 API 路由层复杂度被低估

v1 声称 26 个路由文件，实际 **54 个** (含 22 个 admin 路由和 7 个 internal 路由)。这意味着:
- API 表面面积比预期大一倍
- admin 路由层有独立的权限和逻辑复杂度
- internal 路由增加了内部 API 的维护负担

#### 4.2.2 MCP crate 拆分可优化

7 个 crate 中 `mcp-registry` (2 外部依赖, 0 内部依赖) 和 `mcp-session` (3 依赖, 极薄) 可合并到 `mcp-core`，减少到 5 个 crate。

#### 4.2.3 Rust 模块命名问题

- `conversation/` vs `conversations/` — 单数/复数容易混淆，建议重命名 (如 `conversation_service/` vs `conversation_store/`)
- `voice/tts/` 与 `voice_capabilities/tts.rs` 有轻微重叠 (实现 vs 声明)

---

### 4.3 🟡 中等风险

#### 4.3.1 后端服务层碎片化

40+ 个服务目录，一些小服务仅 1-2 个文件 (`captcha/`, `feedback/`, `secretary/`)。可考虑合并到相关大服务下作为子模块。

#### 4.3.2 安装器过重

`installer/` 是独立的 Tauri + Next.js 项目，对安装器来说可能过重。

#### 4.3.3 配置文件膨胀

**1,568 个配置文件** (1,518 JSON + 35 TOML + 15 YAML)。大量 JSON 可能是测试 fixture 和快照文件，需排查。

#### 4.3.4 TODO/FIXME 极少

- Rust: 0 处
- TypeScript: 2 处 / 1 文件
- Python: 7 处 / 7 文件

**评估**: 要么团队纪律好，要么 TODO 跟踪在 GitHub Issues 中。需确认。

---

### 4.4 🟢 低风险 / 设计偏好

#### 4.4.1 并行路由复杂度

聊天页面 5 个并行路由 (`@assistant`, `@canvas`, `@controls`, `@hud`, `@workspace`) — 灵活但学习成本高。

#### 4.4.2 前端 TypeScript 质量良好

- 27 个 `: any` (10% 文件命中率) — 对 268 文件的代码库很干净
- 6 个 `@ts-ignore` — 极少
- 1 个 `eslint-disable` — 极少

---

## 5. 红蓝对抗验证记录

> 本节记录 v1 → v2 的修正过程，保证审计可信度。

### 5.1 Red Team (10 项质疑)

| # | 质疑 | v1 结论 | 判定 | 关键证据 |
|---|------|---------|------|----------|
| 1 | conversation/ vs conversations/ | 重复 | ❌ **驳回** | IM 薄服务层 vs 持久化基础设施，无文件同时导入两者 |
| 2 | MCP 7 crates | 过度工程化 | ⚠️ **部分确认** | 5/7 有合理边界，mcp-registry + mcp-session 可合并 |
| 3 | voice/audio/voice_capabilities | 重叠 | ❌ **驳回** | TTS 驱动 / 音频 UI 渲染 / 能力声明 — 三个不同关注点 |
| 4 | skills/ vs skill_runtime/ | 重叠 | ❌ **驳回** | 注册表 vs 执行引擎 — 教科书式分层 |
| 5 | Rust 测试覆盖 0.25% | 几乎无测试 | ❌ **严重错误** | 1,344 个测试标记分布在 202 个文件中 |
| 6 | 21 Zustand stores | 过多 | ⚠️ **需上下文** | 未证明耦合问题，Zustand store 成本极低 |
| 7 | deeting_core/tests/ 1621 条目 | 膨胀 | ❌ **驳回** | 实际递归 307 条，顶层 27 条 |
| 8 | Relay 缺生产特性 | 缺配置/健康/关闭 | ⚠️ **部分确认** | 配置管理存在；关闭/健康/可观测性确实缺失 |
| 9 | render_runtime 重复 | 前后端重复 | ❌ **驳回** | 浏览器事件总线 vs Handlebars 模板渲染 — 互补 |
| 10 | AGENTS.md ≈ CLAUDE.md | 内容重复 | ❌ **驳回** | 配置不同工具 (OMX vs OMC)，内容完全不同 |

**Red Team 得分: 0 完全确认, 2 部分确认, 7 驳回, 1 需上下文**

### 5.2 Blue Team (15 项验证/新发现)

| # | 发现 | 状态 | 严重度 |
|---|------|------|--------|
| 1 | 模块数 39 (v1 写 "40+") | ✅ 已验证 | LOW |
| 2 | 数据模型 47 个 (v1 写 49) | ✅ 已修正 | LOW |
| 3 | **API 路由 54 个 (v1 写 26)** | 🔴 **重大修正** | HIGH |
| 4 | 测试文件 282 (v1 暗示 1621) | ✅ 已修正 | MEDIUM |
| 5 | 19 文件有 `#[allow(dead_code)]` | 🆕 新发现 | MEDIUM |
| 6 | **34 个 unwrap() 在 20 个文件** | 🆕 **新发现** | **HIGH** |
| 7 | 9 个 unsafe 块在 3 个文件 | 🆕 新发现 | MEDIUM |
| 8 | 27 个 `: any` 在 10 个 TS 文件 | 🆕 新发现 | LOW |
| 9 | 6 个 @ts-ignore 在 3 个 TS 文件 | 🆕 新发现 | LOW |
| 10 | **422 个 deprecated/legacy 标记在 121 文件** | 🆕 **新发现** | **HIGH** |
| 11 | 1,568 个配置文件 | 🆕 新发现 | MEDIUM |
| 12 | 无硬编码密钥泄露 | ✅ 已验证 | — |
| 13 | 架构文档与代码一致 | ✅ 已验证 | — |
| 14 | middleware.ts 未在 v1 中提及 | ✅ 已补充 | LOW |
| 15 | components/inspection/ 未在 v1 中提及 | ✅ 已补充 | LOW |

### 5.3 v1 方法论问题总结

v1 审计存在系统性方法论缺陷:

1. **按文件名计数而非按内容计数**: Rust 测试按 `*test*` 文件名计数，忽略了惯用的 `#[cfg(test)]` 内联模式，导致覆盖率低估 ~200 倍
2. **仅看目录名推断职责**: `voice/` vs `audio/` 被误判为重叠，实际读代码后发现职责完全不同
3. **符号数不等于复杂度**: 小 store 被建议合并，但未证明耦合关系
4. **find 命令参数错误**: `deeting_core/tests/` 的 1621 计数可能是递归 + `__pycache__` 污染
5. **未读代码即下结论**: AGENTS.md (388 行) 和 CLAUDE.md (65 行) 被判为 "几乎完全相同"，实际配置的是不同工具

---

## 6. 改进建议

### 6.1 🔴 紧急 (1-2 周)

| # | 建议 | 影响 | 优先级 |
|---|------|------|--------|
| 1 | **消除 `memory/fact_extractor.rs` 的 6 个 unwrap()** | 防止记忆子系统 panic | P0 |
| 2 | **消除 `im/` 模块的 4 个 unwrap()** | 防止 IM 桥接崩溃 | P0 |
| 3 | **审查 `custom_task_agents/bound_callables.rs` 的 unsafe 块** | 安全审计 | P0 |

### 6.2 🟠 高优 (2-4 周)

| # | 建议 | 影响 |
|---|------|------|
| 4 | **消除其余 24 个生产 unwrap()** | 提升 Rust 运行时稳定性 |
| 5 | **分层处理 422 个 deprecated/legacy 标记** | 减少技术债务 |
| 6 | **重命名 `conversation/` 和 `conversations/`** | 消除命名混淆 (如 `conversation_service/` vs `conversation_store/`) |
| 7 | **审查 19 个 `#[allow(dead_code)]` 文件** | 清理死代码 |

### 6.3 🟡 中期 (1-2 月)

| # | 建议 | 影响 |
|---|------|------|
| 8 | **合并 `mcp-registry` + `mcp-session` 到 `mcp-core`** (7 → 5 crates) | 减少编译时间 |
| 9 | **为 deeting-relay 添加优雅关闭和健康检查** | 提升可靠性 |
| 10 | **排查 1,518 个 JSON 配置文件** | 确认是否为测试 fixture |
| 11 | **合并后端小服务到相关大服务下** | 减少碎片化 |

### 6.4 🟢 长期 (3-6 月)

| # | 建议 | 影响 |
|---|------|------|
| 12 | **模块依赖图可视化** | 帮助新人理解架构 |
| 13 | **建立 Architecture Decision Records (ADR)** | 记录设计决策 |
| 14 | **前端组件 Storybook** | 提升组件可测试性 |
| 15 | **端到端测试覆盖核心流程** | 保障用户体验 |

---

## 附录: 架构亮点

1. **Local-First 设计哲学**: 所有 AI 执行在桌面端完成，云端只做可选增强。正确的隐私优先设计。

2. **协议层设计成熟**: `protocols/ingress/` + `protocols/egress/` + `protocols/profiles/` 的三层设计支持多协议双向转换，扩展性好。

3. **自进化系统**: `task_learning/` + `posterior_signal/` + `evolution/` 的三层自进化架构是独特设计，让系统能从用户反馈中学习。

4. **Bandit 路由**: 使用多臂老虎机算法做模型路由选择，数据驱动的优雅方案。

5. **Composition-based 执行**: 从 "双 Plane" 迁移到 Composition-based 执行策略，架构更灵活。

6. **Rust 测试文化**: 1,344 个内联测试标记分布在 202 个文件中，~50% 的源文件包含测试 — 在 Rust 项目中属于良好水平。

7. **模块分层清晰**: 经红蓝对抗验证，39 个模块中绝大多数职责边界清晰。`skills/` vs `skill_runtime/`、`conversation/` vs `conversations/`、`voice/` vs `audio/` 均为合理的关注点分离。

8. **完善的架构文档**: 22 篇专题架构文档覆盖了几乎所有子系统，且经验证与代码一致。

9. **前端代码质量**: 268 个组件文件中仅 27 个 `any` 类型、6 个 `@ts-ignore`、1 个 `eslint-disable` — TypeScript 使用规范。

10. **无硬编码密钥**: 所有 `sk-`、`api_key`、`secret` 模式仅出现在测试文件的 dummy 值中。
