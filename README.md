<div align="center">
  <img src="./deeting/app/icon0.svg" alt="Deeting OS logo" width="112" />
  <h1>Deeting OS (谛听)</h1>
  <p><strong>你的专属 AI 网关与智能上下文枢纽</strong></p>
  <p>Local-First AI Gateway & Context Hub</p>
  <p>
    <a href="https://github.com/MarshallEriksen-Neura/Deeting/releases">下载最新版</a>
    ·
    <a href="./README.en.md">English README</a>
    ·
    <a href="./docs/macos-installation.md">macOS 安装说明</a>
    ·
    <a href="./docs/rag-architecture.md">RAG 架构</a>
    ·
    <a href="#快速开始">快速开始</a>
  </p>
</div>

<p align="center">
  <img alt="Release badge" src="./docs/images/readme/badge-release.svg" />
  <img alt="Open source badge" src="./docs/images/readme/badge-open-source.svg" />
  <img alt="Platform badge" src="./docs/images/readme/badge-platform.svg" />
  <img alt="Tauri badge" src="./docs/images/readme/badge-tauri.svg" />
  <img alt="Bandit badge" src="./docs/images/readme/badge-bandit.svg" />
</p>

Deeting OS 是一个本地优先的桌面 AI 平台。它不是单纯的聊天壳子，而是把 AI 对话、技能调用、知识检索、记忆沉淀、终端上下文、灵动岛交互与 IM 协同收拢到同一个工作台里。

如果你想要的不是“再来一个会说话的输入框”，而是一个真正能接入你本地环境、逐步形成上下文资产、并把 AI 能力组织成长期工作流的桌面工作站，Deeting 就是为这个方向设计的。

<p align="center">
  <img src="./docs/images/readme/deeting-hero.png" alt="Deeting overview" width="100%" />
</p>

## Deeting 是什么

Deeting 的核心不是把所有事情都塞进聊天窗口，而是围绕一个更真实的工作模型来构建：

- 你在桌面端与 AI 对话，但 AI 不只看到一段 prompt。
- 它可以接入本地知识、历史记忆、工具能力、文档资产，必要时读取终端上下文。
- 它既可以做一次性回答，也可以逐步沉淀成可复用的技能、知识条目、工作模版和协作入口。

换句话说，Deeting 更像一个面向个人工作站的 AI Gateway，而不是一个只负责“把请求转发给模型”的薄客户端。

## 它解决什么问题

很多 AI 产品在第一次使用时很惊艳，但很快会遇到几个现实问题：

- 模型不了解你当前机器上的真实上下文。
- 有价值的信息散落在聊天记录、文件夹、文档、群聊和终端里，无法沉淀。
- 工具调用和工作流是一次性的，下一次还要重新解释。
- IM 协同、工具调用、本地执行、知识检索分散在不同系统中，缺少统一入口。

Deeting 的方向就是把这些边界重新收拢回来，让桌面端重新成为 AI 的真实工作现场。

<p align="center">
  <img src="./docs/images/readme/deeting-privacy.png" alt="Deeting local-first boundary" width="100%" />
</p>

<p align="center"><em>核心上下文尽量留在桌面端，远端只承担最小必要的补充支持。</em></p>

## 核心能力

### 1. 本地优先的桌面 AI 工作台

- 基于 `Next.js 16 + React 19 + Tauri 2 + Rust` 构建。
- 桌面端承接 AI 对话、工具路由、运行时编排和本地能力接入。
- 既能保留现代 Web UI 的灵活性，也能真正接入本地文件、终端和系统能力。

### 2. AI Gateway 与运行时编排

- 内置多模块桌面 runtime，而不是只做一层 API 转发。
- 后端 Rust 模块覆盖 `desktop_runtime`、`execution`、`skills`、`mcp`、`providers`、`workflow` 等能力域。
- 适合承载工具调用、技能执行、模型路由和本地编排。

### 3. 终端上下文进入聊天链路

- 聊天页面已经接入真实终端，而不是单独的开发者附属窗口。
- 当前实现支持请求级附带 terminal context，由模型按需读取，而不是强制把终端内容塞进输入框。
- 终端协议层已经支持命令边界、上下文快照、右键发送到 AI 等工作流能力。

### 4. 本地知识与 LLM Wiki

- 支持本地知识资产管理、索引与检索。
- 独立的 `llm_wiki` 模块负责本地语义知识工作流，包括 corpus、automation、watcher、maintenance 等链路。
- 适合把零散文档、笔记、资料和项目知识逐步组织成长期可检索的本地知识库。

### 5. 记忆系统

- 不把“聊天历史”直接等同于“记忆”。
- 支持面向长期使用的 memory 存储、搜索、快照和回滚能力。
- 更适合构建持续使用的个人 AI，而不是一次性会话机器人。

### 6. 灵动岛 / Island 交互层

- Chat 路由里已经挂载了 `IslandShell`，不是独立于主工作台之外的装饰性浮窗。
- Tauri 侧预创建了独立 `island` 窗口，支持隐藏/显示、尺寸切换、位置控制和全局快捷键唤起。
- 它更像一个常驻桌面的轻量交互入口：可以承接状态提示、快捷动作、审批、选中文本动作和对话回流，而不要求你每次都回到主窗口。
- 从当前实现看，Island 已经不只是“显示状态”的小窗，还承接了划词后的动作带：`翻译`、`解释`、`总结`、`提问`、`搜索`、`复制` 这类高频动作可以直接在这层完成。
- 其中翻译链路已经是实装能力，不只是文案按钮：包含快速翻译、目标语言选择、最近目标语言记忆，以及在手动打开时优先读取剪贴板文本作为翻译种子。

<p align="center">
  <img src="./docs/images/readme/deeting-island-home.png" alt="Deeting Island home" width="100%" />
</p>

<p align="center"><em>Island 不是装饰性浮窗，而是可以常驻桌面的轻交互入口。</em></p>

<p align="center">
  <img src="./docs/images/readme/deeting-island-translator.png" alt="Deeting Island translator" width="100%" />
</p>

<p align="center"><em>翻译能力已经接进 Island：不必回到完整 chat runtime，也能直接完成快速翻译。</em></p>

### 7. 浏览器插件 / Browser Agent 执行面

- 仓库内已经有独立的 Chrome 扩展执行面 `packages/deeting_chrome/`，定位不是“浏览器里再做一个 AI”，而是给桌面端提供一个受控的浏览器动作出口。
- 当前边界是：桌面 AI 负责决策，扩展负责浏览器侧执行。两者通过 localhost WebSocket bridge 连接，而不是把主逻辑搬到扩展里。
- 从现有实现看，这条链路已经覆盖了几个关键能力：连接桌面端、打开标签页、读取结构化页面快照、执行受限的点击 / 输入 / 滚动动作，以及对高风险动作进行审批。
- 对用户来说，它更像是“让 Deeting 真正伸进浏览器页面”的那只手，而不是一个独立的浏览器聊天插件。

<p align="center">
  <img src="./docs/images/readme/deeting-browser-agent-popup.png" alt="Deeting Browser Agent popup" width="78%" />
</p>

<p align="center"><em>浏览器插件侧负责连接当前页面、发起 Ask Current Page / Search Wiki / Search Memory 等浏览器侧动作。</em></p>

<p align="center">
  <img src="./docs/images/readme/deeting-browser-agent-island-result.png" alt="Deeting Browser Agent result in Island" width="100%" />
</p>

<p align="center"><em>浏览器侧结果不会停留在扩展里，而是回流到桌面端 Island，再决定是否继续带入聊天工作台。</em></p>

### 8. 兼容式扩展能力

- 仓库里仍然保留了 `packages/`、`skills`、`mcp` 等扩展面，说明 Deeting 并不排斥扩展。
- 但当前产品叙事重点不在“要求你额外采用 Deeting 自定义链路来创建插件”，而更偏向复用已有生态，把桌面 runtime 接好。
- 换句话说，扩展能力是底座的一部分，但不是当前 README 需要主推的第一卖点。

### 9. 本地执行与沙箱

- 支持本地代码执行、桌面侧执行能力以及沙箱运行时接入。
- 仓库内包含 BoxLite 相关侧车与 sandbox 模块，用于承接更安全的执行场景。
- 适合后续扩展代码运行、文档生成、工具链编排等能力。

### 10. IM 协同入口

- 当前 IM 模块已经覆盖 `Feishu`、`Telegram`、`Wechat` 方向。
- 桌面端并不是公网回调入口，`deeting-relay/` 提供了对外 relay 边界。
- 更接近“桌面端作为真实执行者，IM 只是外部触达面”的产品边界。

## 真实使用场景

如果你担心 README 说得太抽象，下面这 4 个场景更接近 Deeting 想服务的真实工作方式。

### 场景 1：一边对话，一边带着终端上下文排查问题

你正在本地跑项目、看日志、执行命令，问题并不只存在于一段报错文本里，而是在当前 shell 状态、最近几条命令、输出结果和工作目录里。

在这种情况下，Deeting 的价值不是再开一个独立聊天窗口，而是让聊天链路真正接到 terminal context。这样 AI 看到的不只是你手工复制的一小段错误，而是更接近当前桌面现场的上下文快照。

如果主窗口不是你当前的焦点，Island 还可以作为更轻的唤起层，把终端相关的状态、动作和对话入口保持在桌面表面，而不是把所有操作都塞回完整工作台里。

这也是 Island 在这个产品里真正重要的地方：它不是为了好看，而是为了让 AI 工作台从“必须完整打开的主窗口”变成“能持续贴在桌面表面的轻交互层”。

### 场景 2：主窗口不在前台时，仍然处理审批、划词和快捷回复

很多桌面 AI 产品一旦主窗口收起，交互就基本中断了。但从仓库现状看，Deeting 的 Island 已经不只是一个状态胶囊，它实际承接了 recent messages、pending approval、selection context、browser lookup 和 quick reply 这一类轻交互状态。

这意味着你不必每次都完整切回主工作台，才能继续处理一个审批、对选中文本发起动作，或者先用一条短回复把上下文接住。Island 在这里承担的是“桌面上的持续在场”，不是“主窗口的缩略图”。

更具体一点说，当前这层已经在往“选中即处理”的方向走：你选中一段文本后，不一定非要回到完整 chat 页面再组织 prompt，而是可以直接从 Island 触发 `翻译 / 解释 / 总结 / 提问 / 搜索 / 复制` 这些动作。对于阅读外文、看文档、扫群聊、过网页内容这种高频桌面场景，这比每次手动粘贴回主窗口自然得多。

如果你给 README 配这张图，最值得强调的不是视觉样式，而是这条动作带本身代表的交互变化：AI 不再只存在于主工作台里，而是开始贴着你当前正在阅读或选中的内容工作。

<p align="center">
  <img src="./docs/images/readme/deeting-island-selection-actions.png" alt="Deeting Island selected text actions" width="100%" />
</p>

<p align="center"><em>划词后的 Island 动作带，把翻译、解释、总结、提问、搜索、复制直接贴到当前阅读现场。</em></p>

### 场景 3：把零散资料逐步沉淀成长期可检索的本地知识系统

很多时候你不是缺一个回答，而是缺一个能长期积累的知识容器。项目文档、会议记录、技术笔记、研究资料、截图说明，平时都散落在不同目录和工具里。

Deeting 这里的定位不是临时问答，而是让 knowledge、memory 和 `llm_wiki` 一起工作：先摄入，再整理，再检索，再复用。你下一次回来时，不需要从零重新解释上下文。

### 场景 4：桌面端负责真实执行，IM 只是外部触达入口

很多团队会希望 AI 能从飞书或其他 IM 被触达，但真正敏感的模型配置、知识资产、工具执行和本地环境，不适合直接暴露在公网回调面上。

Deeting 的边界更接近这样一条链路：IM 事件先进入 `deeting-relay`，再由桌面端拉取并执行，最后把结果回传。这样桌面端仍然是实际运行时和上下文中心，而 IM 只是更方便的协同入口。

## 架构概览

如果用一句话概括 Deeting 当前的结构，它更像是一个以桌面端为核心的 AI runtime，而不是一个单纯的聊天壳层。

### 1. 桌面端是主系统，不是展示层

主应用位于 `deeting/`，前端负责工作台界面、聊天、知识、记忆、终端和设置等交互，而 Tauri + Rust 负责把这些界面真正接到本地 runtime 上。

这意味着桌面端不是一个只负责展示 API 返回结果的壳，而是产品真正的执行现场。

### 2. Rust runtime 负责能力编排

`deeting/src-tauri/src/modules/` 下面已经拆出 `desktop_runtime`、`execution`、`terminal`、`knowledge`、`memory`、`llm_wiki`、`skills`、`mcp`、`providers`、`workflow`、`sandbox` 等模块。

这些模块共同承担模型调用、工具路由、执行控制、状态持有、知识检索、扩展接入和本地能力桥接，构成了 Deeting 的核心运行时。

### 3. 前端工作台和本地能力是直接连着的

在 Deeting 里，chat 不只是一个输入框，terminal 也不是一个孤立面板，knowledge 和 memory 也不是单独的附件页。它们的目标都是汇入同一条桌面 runtime 链路。

所以更准确的理解方式不是“几个页面”，而是“几个共享同一上下文系统的入口”。

### 4. Island 把工作台带到桌面表面

Deeting 没有把所有交互都锁死在主窗口里。`IslandShell`、独立 `island` 窗口、全局快捷键、隐藏主窗口后显示 Island 的窗口策略，说明它在尝试把 AI 工作台做成一种更常驻的桌面存在。

这层设计的意义不只是“多一个小窗”，而是让状态提示、快捷回复、审批处理、选中文本动作、划词翻译、内容解释、搜索跳转、恢复主工作台这些行为，都可以在更轻的交互层里完成。

如果说主窗口代表完整工作台，那么 Island 更像是这个工作台在桌面表面露出的那一层。

### 5. 扩展面围绕技能、协议兼容和执行能力展开

Deeting 不是只靠内建功能增长。`skills` / `mcp` 相关模块、`packages/` 中保留的扩展面，以及本地执行与 sandbox 能力，决定了它可以继续长成一个可扩展工作站，而不是一组固定功能页。

<p align="center">
  <img src="./docs/images/readme/deeting-bandit-feedback.png" alt="Deeting feedback loop" width="100%" />
</p>

<p align="center"><em>反馈回写不是附属细节，而是让路由越来越贴近真实使用偏好的学习闭环。</em></p>

### 6. 浏览器插件是浏览器执行面，不是第二个大脑

`packages/deeting_chrome/` 的边界写得很明确：desktop AI 是 decision surface，extension 是 bounded browser execution surface。也就是说，浏览器插件在这里承担的是“读页面、做动作、回传结果”，而不是自己变成另一套独立 Agent 系统。

这对 README 很重要，因为它决定了浏览器插件应该被介绍成什么：不是又一个独立产品，而是 Deeting 桌面 runtime 向浏览器页面伸出的执行能力。

### 7. IM 在这里是入口，不是真正的系统中心

`deeting-relay/` 的存在说明了一个很重要的边界：外部消息入口可以在 IM，但实际的上下文、工具执行和运行时真相仍然在桌面端。

这也是为什么 Deeting 的 README 更适合围绕“桌面端能做什么”来写，而不是围绕某个外部接入渠道来组织。

> 📖 想深入理解 Deeting 的 RAG / 上下文编排子系统（Context Orchestrator、三大检索源、context 工具、No Double Lifecycle Rule、selected knowledge 兜底链路），请直接阅读 [docs/rag-architecture.md](./docs/rag-architecture.md)。

## 一个更真实的工作流

你可以把 Deeting 理解为下面这条链路：

1. 你在桌面端发起对话或任务。
2. Deeting 按需引入本地知识、记忆、工具能力、终端上下文或文档资产。
3. 桌面 runtime 负责模型调用、工具编排、执行和结果回流。
4. 有价值的结果再被沉淀为知识、记忆、模版或可复用工作流能力。

这也是它和常规聊天产品最大的差别：它关心的不是一次回答，而是持续形成你的个人上下文系统。

<p align="center">
  <img src="./docs/images/readme/deeting-workflow.png" alt="Deeting workflow" width="100%" />
</p>

## 适合谁

- 希望 AI 真正接入本地工作环境的个人开发者或重度桌面用户。
- 希望把知识、记忆、工具和会话统一到一个工作台里的 AI 产品探索者。
- 想要扩展技能、文档生成、知识检索或 IM 协同能力的构建者。
- 希望把 AI 做成真正的桌面工作站，而不只是一个对话界面的团队。

## 快速开始

### 安装

从 [GitHub Releases](https://github.com/MarshallEriksen-Neura/Deeting/releases) 下载最新版本。

#### Windows

下载 `Deeting Setup_x.x.x_x64-bootstrapper.exe`，运行图形化安装器即可。

#### macOS

由于项目当前未进行 Apple 公证签名，首次打开需要额外确认。详见 [macOS 安装说明](./docs/macos-installation.md)。

#### Linux

下载 `.deb` 或 `.AppImage`，按常规方式安装。

### 首次启动前你需要准备

1. 本机具备 `Python 3` 与 `Node.js` 环境。
2. 至少有一个可用的模型服务配置。
3. 至少有一个 embedding 模型，用于知识/记忆相关能力。

### 首次启动建议顺序

1. 安装并打开 Deeting。
2. 进入 dashboard，配置你的 AI 服务。
3. 在模型页拉取或同步一次模型列表。
4. 在设置页完成 agent 运行检测。
5. 配置桌面秘书模型与 embedding 模型。
6. 按你的习惯设置 Island 的唤起快捷键，以及关闭主窗口后的行为。
7. 再开始使用 chat、knowledge、memory、Island 等能力。

## 开发

主桌面应用位于 [`deeting/`](./deeting/)。

### 启动前端开发环境

```bash
cd deeting
bun install
bun run dev
```

### 启动桌面开发环境

```bash
cd deeting
bun install
bun run desktop:dev
```

### 构建桌面应用

```bash
cd deeting
bun run desktop:build
```

`deeting/scripts/tauri-with-protoc.mjs` 会在启动 Tauri 命令时自动处理 `PROTOC` 检测与注入。

## 仓库结构

```text
.
├─ deeting/           # 主桌面应用（Next.js + Tauri + Rust）
├─ deeting_core/      # 核心后端/任务与测试资产
├─ deeting-relay/     # IM relay 服务，作为公网 ingress 边界
├─ installer/         # Windows 图形化安装器
├─ scout/             # 独立侦察/抓取微服务
├─ packages/          # 扩展相关模板、SDK 与兼容资产
│  └─ deeting_chrome/ # Chrome 浏览器执行面扩展
├─ docs/              # 文档与 README 配图
└─ scripts/           # 辅助脚本
```

其中最核心的几个目录：

- [`deeting/`](./deeting/)：主产品入口，包含前端界面、Tauri 壳层和 Rust 模块。
- [`deeting-relay/`](./deeting-relay/)：让 Feishu 等 IM 回调先进入 relay，再由桌面端消费执行。
- [`packages/`](./packages/)：保留的扩展相关模板、SDK 与兼容资产。
- [`packages/deeting_chrome/`](./packages/deeting_chrome/)：浏览器执行面扩展，让桌面端把决策延伸到网页读取与受控 DOM 动作。
- [`scout/`](./scout/)：用于网页侦察、抓取与深度递归 crawling 的独立服务。

## 仓库内已经存在的关键能力域

如果你想快速判断这个仓库现在到底覆盖到什么程度，`deeting/src-tauri/src/modules/` 下已经能看到这些方向：

- `desktop_runtime`
- `execution`
- `terminal`
- `knowledge`
- `memory`
- `llm_wiki`
- `skills`
- `mcp`
- `providers`
- `workflow`
- `generated_files`
- `image_generation`
- `im`
- `sandbox`

这也是为什么 README 不应该只写成“AI 聊天应用”介绍页。它已经明显超出一个普通 chat app 的范围。

> 📖 其中 `desktop_runtime/context_orchestrator/` + `knowledge` + `memory` + `llm_wiki` + `retrieval_kernel` 共同构成本地 RAG / 上下文编排子系统，独立文档见 [docs/rag-architecture.md](./docs/rag-architecture.md)。

## 子项目说明

### `deeting-relay`

轻量 relay 服务，用于承接飞书等 IM 的公网回调，再转交给本地桌面端执行。

### `scout`

独立侦察微服务，负责网页抓取、反爬对抗和深度 crawling，适合做外部知识摄取。

### `packages`

扩展相关工具箱，包含 SDK、模板和兼容资产；它存在，但不是当前产品叙事的核心中心。

### `installer`

Windows 图形化安装器，负责把主应用以更友好的安装路径交付给最终用户。

## 开源信号

如果你除了想知道“它是什么”，还想知道“它是不是一个活着的开源项目”，这里直接给你最重要的那张图：

## Star History

<a href="https://www.star-history.com/?repos=MarshallEriksen-Neura%2FDeeting&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=MarshallEriksen-Neura/Deeting&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=MarshallEriksen-Neura/Deeting&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=MarshallEriksen-Neura/Deeting&type=date&legend=top-left" />
 </picture>
</a>

## 社区与更新

如果你也认同 `真诚`、`友善`、`团结`、`专业`，欢迎加入 [LinuxDo](https://linux.do/latest)。

我会在这里持续更新 Deeting 的进展说明：

- [Deeting 更新说明 / 讨论帖](https://linux.do/t/topic/2070886)
