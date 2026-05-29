# Deeting 桌面端架构

> 本文档提供 Deeting 桌面端（`deeting/`）的详细架构视图。
> 各子系统的详细设计文档见各自的专题文档。
> 整体仓库结构见 [README.md](../README.md)。

## 1. TL;DR

Deeting 桌面端是一个 **Local-First AI 工作台**，基于 **Next.js 16 + React 19 + Tauri 2 + Rust** 构建：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        deeting/ 桌面端架构                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Next.js + React 19（前端 UI）                                        │  │
│  │                                                                       │  │
│  │  app/[locale]/          页面路由（i18n 国际化）                       │  │
│  │    ├─ chat/             主聊天工作台                                  │  │
│  │    ├─ knowledge/        本地知识库                                    │  │
│  │    ├─ memory/           长期记忆                                      │  │
│  │    ├─ llm-wiki/         语义 Wiki                                     │  │
│  │    ├─ skills/           技能管理                                      │  │
│  │    ├─ mcp/              MCP Server 管理                               │  │
│  │    ├─ models/           模型配置                                      │  │
│  │    ├─ settings/         设置                                          │  │
│  │    ├─ island/           灵动岛                                        │  │
│  │    └─ dashboard/        仪表盘                                        │  │
│  │                                                                       │  │
│  │  components/            React 组件                                    │  │
│  │  store/                 Zustand 状态管理                              │  │
│  │  hooks/                 React Hooks                                   │  │
│  │  lib/                   工具库（api/http/swr/chat/...）               │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    │ Tauri IPC                               │
│                                    ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Tauri + Rust Runtime                                                 │  │
│  │                                                                       │  │
│  │  src-tauri/src/                                                       │  │
│  │    ├─ main.rs / lib.rs       应用入口                                 │  │
│  │    ├─ commands.rs            Tauri 命令注册                           │  │
│  │    ├─ state.rs               全局状态                                 │  │
│  │    ├─ setup.rs               初始化                                   │  │
│  │    └─ modules/               核心模块                                 │  │
│  │         ├─ desktop_runtime/  本地对话编排（核心）                     │  │
│  │         ├─ execution/        工具执行路由                             │  │
│  │         ├─ memory/           长期记忆                                 │  │
│  │         ├─ knowledge/        本地知识库                               │  │
│  │         ├─ llm_wiki/         语义 Wiki                                │  │
│  │         ├─ retrieval_kernel/ 检索核心（lifecycle/ranking）            │  │
│  │         ├─ skills/           技能包                                   │  │
│  │         ├─ mcp/              MCP 管理                                 │  │
│  │         ├─ terminal/         终端上下文                               │  │
│  │         ├─ sandbox/          代码沙箱                                 │  │
│  │         ├─ providers/        模型 Provider                            │  │
│  │         ├─ workflow/         工作流引擎                               │  │
│  │         ├─ im/               IM 消息处理                              │  │
│  │         ├─ image_generation/ 图像生成                                 │  │
│  │         ├─ voice/            语音                                     │  │
│  │         └─ ...               其他模块                                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2. 设计哲学

### Local-First

Deeting 的核心设计原则是 **Local-First（本地优先）**：

| 原则 | 说明 |
|------|------|
| **上下文留在桌面** | 对话历史、知识资产、记忆、终端上下文都存储在本机 SQLite |
| **桌面端是运行时** | AI 推理调用、工具执行、技能运行都在桌面端完成 |
| **云端是可选增强** | deeting_core 提供团队协同、计费等云端能力，但桌面端可独立运行 |
| **IM 是触达面** | deeting-relay 只做消息 ingress，实际执行仍在桌面端 |

### 架构分层

```
┌─────────────────────────────────────────────────────────────────────┐
│  接入面 (Ingress Surface)                                            │
│  - Island（桌面常驻轻交互）                                          │
│  - Chrome 扩展（浏览器执行面）                                       │
│  - IM Relay（飞书/Telegram/WeChat）                                  │
│  - 主窗口 Chat UI                                                    │
├─────────────────────────────────────────────────────────────────────┤
│  桌面运行时 (Desktop Runtime)                                        │
│  - LocalOrchestrationEngine（对话编排流水线）                        │
│  - chat_tool_runtime（Agentic Loop）                                 │
│  - Context Orchestrator（上下文编排）                                │
│  - Execution Graph（DAG 执行图）                                     │
│  - Tool Catalog + Execution（工具封装与执行）                        │
├─────────────────────────────────────────────────────────────────────┤
│  能力层 (Capability Layer)                                           │
│  - Memory（长期记忆）                                                │
│  - Knowledge（本地知识库）                                           │
│  - LLM Wiki（语义知识工作流）                                        │
│  - Skills（技能包）                                                  │
│  - MCP（Model Context Protocol 工具）                                │
│  - Terminal（终端上下文）                                            │
│  - Sandbox（代码执行沙箱）                                           │
├─────────────────────────────────────────────────────────────────────┤
│  存储层 (Storage)                                                    │
│  - SQLite（对话、记忆、知识、配置）                                  │
│  - 向量索引（embedding 检索）                                        │
│  - 文件系统（知识文件、Wiki corpus）                                 │
└─────────────────────────────────────────────────────────────────────┘
```

## 3. 前端架构（Next.js + React）

### 3.1 页面路由

```
app/[locale]/                    # i18n 国际化路由
├── page.tsx                     # 首页（重定向到 chat）
├── layout.tsx                   # 全局布局
├── chat/                        # 主聊天工作台
├── knowledge/                   # 本地知识库
├── memory/                      # 长期记忆
├── llm-wiki/                    # 语义 Wiki
├── skills/                      # 技能管理
├── mcp/                         # MCP Server 管理
├── models/                      # 模型配置
├── settings/                    # 设置
├── island/                      # 灵动岛（独立窗口）
├── dashboard/                   # 仪表盘
├── agents/                      # Agent 管理
├── admin/                       # 管理后台
├── login/                       # 登录
├── scan-reviews/                # 扫描审核
└── workflow/                    # 工作流
```

### 3.2 组件结构

```
components/
├── chat/                 # 聊天相关组件
│   ├── messages/         # 消息渲染
│   ├── input/            # 输入框
│   ├── status-rail.tsx   # 状态指示器
│   └── ...
├── island/               # 灵动岛组件
├── terminal/             # 终端组件
├── knowledge/            # 知识库组件
├── memory/               # 记忆组件
├── mcp/                  # MCP 组件
├── skills/               # 技能组件
├── models/               # 模型组件
├── providers/            # Provider 组件
├── dashboard/            # 仪表盘组件
├── workflow/             # 工作流组件
├── admin/                # 管理后台组件
├── auth/                 # 认证组件
├── audio/                # 音频组件
├── bridge/               # 浏览器桥接组件
├── common/               # 通用组件
├── contexts/             # React Context
├── layout/               # 布局组件
├── notifications/        # 通知组件
├── plugins/              # 插件组件
├── ui/                   # Shadcn UI 基础组件
└── views/                # 视图组件
```

### 3.3 状态管理（Zustand）

```
store/
├── chat-store.ts                    # 聊天状态
├── chat-runtime-store.ts            # 聊天运行时
├── auth-store.ts                    # 认证状态
├── user-store.ts                    # 用户状态
├── terminal-panel-store.ts          # 终端面板
├── workspace-store.ts               # 工作空间
├── workflow-store.ts                # 工作流
├── theme-store.ts                   # 主题
├── language-store.ts                # 语言
├── notification-store.ts            # 通知
├── market-store.ts                  # 市场
├── modal-store.ts                   # 弹窗
├── artifact-store.ts                # 产物
├── browser-mode-store.ts            # 浏览器模式
├── capability-settings-store.ts     # 能力设置
├── spec-agent-store.ts              # Spec Agent
├── video-generation-store.ts        # 视频生成
└── persist-storage.ts               # 持久化存储
```

### 3.4 工具库

```
lib/
├── api/                  # API 调用封装
├── http/                 # HTTP 客户端
├── swr/                  # SWR 数据获取
├── chat/                 # 聊天工具
├── auth/                 # 认证工具
├── providers/            # Provider 工具
├── mcp/                  # MCP 工具
├── browser/              # 浏览器工具
├── execution-tree/       # 执行树
├── render-runtime/       # 渲染运行时
├── workflow/             # 工作流工具
├── runtime/              # 运行时工具
├── platform/             # 平台检测
├── utils/                # 通用工具
└── constants/            # 常量定义
```

## 4. Rust 运行时（Tauri）

### 4.1 入口文件

```rust
src-tauri/src/
├── main.rs               // 应用入口
├── lib.rs                // Tauri 插件注册
├── commands.rs           // Tauri 命令注册
├── state.rs              // 全局状态
├── setup.rs              // 初始化逻辑
├── tray.rs               // 系统托盘
└── utils.rs              // 工具函数
```

### 4.2 核心模块（`modules/`）

#### 对话与编排

| 模块 | 职责 | 详细文档 |
|------|------|----------|
| `desktop_runtime/` | 本地对话编排引擎 | [rag-architecture.md](./rag-architecture.md) |
| `desktop_runtime/context_orchestrator/` | 上下文编排（RAG） | [rag-architecture.md](./rag-architecture.md) |
| `desktop_runtime/local_orchestrator/` | 本地编排流水线 | [agent-dag-architecture.md](./agent-dag-architecture.md) |
| `desktop_runtime/runtime/` | 运行时核心 | [agent-dag-architecture.md](./agent-dag-architecture.md) |
| `execution/` | 工具执行路由 | [tool-architecture.md](./tool-architecture.md) |

#### 知识与记忆

| 模块 | 职责 | 详细文档 |
|------|------|----------|
| `memory/` | 长期记忆、Write Guard、Fact Extractor | [memory-architecture.md](./memory-architecture.md) |
| `knowledge/` | 本地知识库、FTS5 + 语义检索 | [rag-architecture.md](./rag-architecture.md) |
| `llm_wiki/` | 语义知识工作流、Corpus 管理 | [rag-architecture.md](./rag-architecture.md) |
| `retrieval_kernel/` | 生命周期衰减、Supersession、Ranking | [memory-architecture.md](./memory-architecture.md) |

#### 扩展与工具

| 模块 | 职责 | 详细文档 |
|------|------|----------|
| `skills/` | 技能包注册与执行 | [tool-architecture.md](./tool-architecture.md) |
| `mcp/` | MCP Server 管理与工具调用 | [tool-architecture.md](./tool-architecture.md) |
| `terminal/` | 终端上下文捕获 | - |
| `sandbox/` | 代码执行沙箱（BoxLite） | [security-architecture.md](./security-architecture.md) |

#### 模型与路由

| 模块 | 职责 | 详细文档 |
|------|------|----------|
| `providers/` | 模型 Provider 配置 | - |
| `ai_upstream/` | 上游 AI 服务 | - |
| `ai_access/` | AI 访问控制 | - |

#### 执行与自进化子系统（`desktop_runtime/runtime/`）

| 模块 | 职责 | 详细文档 |
|------|------|----------|
| `execution_plane/` | 执行编排（Composition-based） | - |
| `execution_plane/composition/` | 阶段步骤（Phase Step）编排 | - |
| `execution_plane/delegation/` | 委托执行（Workflow/Agent） | - |
| `execution_graph/` | DAG 执行图 | [agent-dag-architecture.md](./agent-dag-architecture.md) |
| `task_learning/` | TaskFingerprint、PolicyDelta、先验库 | [self-evolution-architecture.md](./self-evolution-architecture.md) |
| `posterior_signal/` | 用户后验信号处理 | [self-evolution-architecture.md](./self-evolution-architecture.md) |
| `evolution/` | 自进化核心 | [self-evolution-architecture.md](./self-evolution-architecture.md) |
| `sovereign/` | Sovereign 架构 | [self-evolution-architecture.md](./self-evolution-architecture.md) |

#### 其他模块

| 模块 | 职责 |
|------|------|
| `workflow/` | 工作流引擎 |
| `im/` | IM 消息处理 |
| `image_generation/` | 图像生成 |
| `generated_files/` | 文档生成 |
| `browser_agent/` | 浏览器 Agent |
| `voice/` / `audio/` | 语音交互 |
| `voice_capabilities/` | 语音能力 |
| `island_window/` | Island 灵动岛窗口 |
| `selection_assistant/` | 划词助手 |
| `monitor/` | 监控 |
| `scan/` | 扫描 |
| `relay/` | Relay 客户端 |
| `conversation/` / `conversations/` | 对话管理 |
| `assistants/` | Assistant 管理 |
| `custom_task_agents/` | 自定义任务 Agent |
| `capability_control_plane/` | 能力控制面 |
| `asset_registry/` | 资产注册 |
| `external_sources/` | 外部源 |
| `render_runtime/` | 渲染运行时 |
| `skill_runtime/` | 技能运行时 |
| `rag_eval/` | RAG 评测 |
| `code_mode/` | Code Mode |
| `chat_assets/` | 聊天资产 |
| `admin/` | 管理 |
| `desktop_config/` | 桌面配置 |

### 4.3 执行策略（Execution Strategy）

当前执行模型已从"双 Plane"迁移到 **Composition-based 执行策略**：

```
┌─────────────────────────────────────────────────────────────────────┐
│ ExecutionStrategy（执行策略）                                       │
│                                                                     │
│  DirectIteration     → DirectChat 阶段（直接对话迭代）              │
│  DelegatedWorkflow   → DelegatedWorkflow 阶段（委托给工作流）       │
│  DelegatedAgent      → DelegatedWorker 阶段（委托给 Agent）         │
│  Hybrid              → 根据 policy 回退                             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ PhaseStepType（阶段步骤）                                           │
│                                                                     │
│  DirectChat          直接对话                                       │
│  ToolCall            工具调用                                       │
│  DelegatedWorker     委托给 Worker Agent                            │
│  DelegatedWorkflow   委托给 Workflow 引擎                           │
│  CapabilityAdmit     能力准入                                       │
│  VerifyFinal         最终验证                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.4 模块关系图

```
┌─────────────────────────────────────────────────────────────────────┐
│ LocalOrchestrationEngine                                            │
│                                                                     │
│  SummaryInjectionStep                                               │
│  PersonaPromptInjectionStep                                         │
│  ContextManifestStep ← context_orchestrator/                        │
│  RouteSelectionStep  ← evolution/ + task_learning/                  │
│  SkillRecipeInjectionStep ← skills/                                 │
│  TemplateRenderStep                                                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ execution_plane (Composition-based)                                 │
│                                                                     │
│  根据 ExecutionStrategy 选择 PhaseStep：                            │
│    DirectIteration    → chat_completion/                            │
│    DelegatedWorkflow  → delegation/ (workflow)                      │
│    DelegatedAgent     → delegation/ (agent)                         │
│                                                                     │
│  每轮：                                                             │
│    1. 调用 LLM Provider ← providers/                                │
│    2. 解析 tool_calls                                               │
│    3. 执行工具                                                      │
│       - context_* → context_orchestrator/tools.rs                   │
│       - skill_* → skills/                                           │
│       - mcp_* → mcp/                                                │
│       - shell_* → sandbox/                                          │
│       - delegate_* → delegation/                                    │
│    4. 结果写回 orchestrated_messages                                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 后处理                                                              │
│                                                                     │
│  - Fact Extractor → memory/                                         │
│  - Task Learning → task_learning/                                   │
│  - Execution Graph → execution_graph/                               │
│  - Posterior Signal → posterior_signal/                             │
└─────────────────────────────────────────────────────────────────────┘
```

## 5. 数据流

### 5.1 本地对话流程

```
用户输入
    │
    ▼
┌───────────────────────────────────────────────────────────────────┐
│ LocalOrchestrationEngine                                          │
│                                                                   │
│  1. SummaryInjectionStep        注入会话摘要                      │
│  2. PersonaPromptInjectionStep  注入人格 Prompt                   │
│  3. ContextManifestStep         注入上下文清单（不注入正文）      │
│  4. RouteSelectionStep          路由选择（含 Bandit + Prior）     │
│  5. SkillRecipeInjectionStep    注入技能配方                      │
│  6. TemplateRenderStep          渲染最终 Prompt                   │
└───────────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────────┐
│ chat_tool_runtime (Agentic Loop)                                  │
│                                                                   │
│  每轮：                                                           │
│    1. 调用 LLM Provider                                           │
│    2. 解析 tool_calls                                             │
│    3. 执行工具（context_* / skill / MCP / shell / sandbox）       │
│    4. 结果写回 orchestrated_messages                              │
│    5. 继续下一轮或 finalize                                       │
└───────────────────────────────────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────────┐
│ 后处理                                                            │
│                                                                   │
│  - Fact Extractor：抽取长期事实写入 Memory                        │
│  - Task Learning：评估任务结果，更新先验                          │
│  - Execution Graph：持久化 DAG 到 SQLite                          │
└───────────────────────────────────────────────────────────────────┘
```

### 5.2 IM 触达流程

```
飞书/Telegram 用户发送消息
    │
    ▼
┌───────────────────────────────────────────────────────────────────┐
│ deeting-relay (Go)                                                │
│                                                                   │
│  1. 验证 Webhook 签名                                             │
│  2. 解析消息内容                                                  │
│  3. 存入消息队列                                                  │
│  4. 等待桌面端拉取                                                │
└───────────────────────────────────────────────────────────────────┘
    │
    │ WebSocket / Long Polling
    ▼
┌───────────────────────────────────────────────────────────────────┐
│ 桌面端 modules/im/ + modules/relay/                               │
│                                                                   │
│  1. 拉取 IM 消息                                                  │
│  2. 进入本地对话流程（同上）                                      │
│  3. 执行工具、调用模型                                            │
│  4. 结果通过 relay 回传 IM                                        │
└───────────────────────────────────────────────────────────────────┘
```

## 6. 安全边界

| 边界 | 说明 | 详细文档 |
|------|------|----------|
| **桌面端主权** | 所有 AI 执行在桌面端完成 | - |
| **IM 隔离** | deeting-relay 只做 ingress | [deeting-relay-architecture.md](./deeting-relay-architecture.md) |
| **Approval Gate** | 高危工具需要用户显式审批 | [agent-dag-architecture.md](./agent-dag-architecture.md) |
| **Execution Strategy** | 根据策略选择执行路径（Direct/Delegated） | - |
| **Sandbox** | 代码执行在 BoxLite 沙箱内运行 | [security-architecture.md](./security-architecture.md) |
| **Provider 密钥** | API Key 存储在桌面端本地 | - |

## 7. 专题文档索引

| 主题 | 文档 |
|------|------|
| RAG / 上下文编排 | [rag-architecture.md](./rag-architecture.md) |
| Agent DAG 执行模型 | [agent-dag-architecture.md](./agent-dag-architecture.md) |
| 工具封装架构 | [tool-architecture.md](./tool-architecture.md) |
| 记忆系统 | [memory-architecture.md](./memory-architecture.md) |
| 自进化 / 自调整 | [self-evolution-architecture.md](./self-evolution-architecture.md) |
| Bandit 多臂老虎机 | [bandit-architecture.md](./bandit-architecture.md) |
| 双 Plane 执行 | [dual-plane-architecture.md](./dual-plane-architecture.md) |
| 安全策略 | [security-architecture.md](./security-architecture.md) |
| macOS 安装 | [macos-installation.md](./macos-installation.md) |
| RAG 评测 | [rag-eval.md](./rag-eval.md) |
| IM Relay | [deeting-relay-architecture.md](./deeting-relay-architecture.md) |

## 8. 仓库结构

```text
deeting/
├─ app/                   # Next.js 页面路由
│  └─ [locale]/           # i18n 国际化
│     ├─ chat/            # 主聊天工作台
│     ├─ knowledge/       # 本地知识库
│     ├─ memory/          # 长期记忆
│     ├─ skills/          # 技能管理
│     ├─ mcp/             # MCP 管理
│     ├─ models/          # 模型配置
│     ├─ settings/        # 设置
│     ├─ island/          # 灵动岛
│     └─ ...
│
├─ components/            # React 组件
│  ├─ chat/               # 聊天组件
│  ├─ island/             # 灵动岛组件
│  ├─ terminal/           # 终端组件
│  ├─ ui/                 # Shadcn UI
│  └─ ...
│
├─ store/                 # Zustand 状态管理
├─ hooks/                 # React Hooks
├─ lib/                   # 工具库
├─ messages/              # i18n 翻译 JSON
├─ constants/             # 常量定义
├─ types/                 # TypeScript 类型
│
└─ src-tauri/             # Tauri + Rust 运行时
   └─ src/
      ├─ main.rs          # 入口
      ├─ commands.rs      # Tauri 命令
      └─ modules/         # 核心模块
         ├─ desktop_runtime/  # 对话编排
         ├─ execution/        # 工具执行
         ├─ memory/           # 记忆
         ├─ knowledge/        # 知识
         ├─ llm_wiki/         # Wiki
         ├─ skills/           # 技能
         ├─ mcp/              # MCP
         ├─ terminal/         # 终端
         ├─ sandbox/          # 沙箱
         └─ ...
```

## 9. 开发

### 前端开发

```bash
cd deeting
bun install
bun run dev              # 启动 Next.js 开发服务器
```

### 桌面端完整开发

```bash
cd deeting
bun install
bun run desktop:dev      # 启动 Tauri + Next.js 开发
```

### 构建桌面应用

```bash
cd deeting
bun run desktop:build    # 构建桌面应用
```

### 测试

```bash
# 前端测试
cd deeting
bun test

# Rust 测试
cd deeting/src-tauri
cargo test
```

## 10. 技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | Next.js 16 |
| UI 库 | React 19 |
| UI 组件 | Shadcn UI + Radix UI |
| 状态管理 | Zustand |
| 数据获取 | SWR |
| 国际化 | next-intl |
| 桌面框架 | Tauri 2 |
| 后端语言 | Rust |
| 数据库 | SQLite |
