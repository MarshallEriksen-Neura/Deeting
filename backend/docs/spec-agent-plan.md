# Spec Agent 架构演进计划

## 1. 核心理念 (Philosophy)

### 1.1 "Spec-Mode" (规格模式)
我们不再构建黑盒式的自动 Agent，而是构建一个透明的、可交互的**智能任务管理系统**。
- **Drafting (拟态)**: 用户表达意图 -> LLM 生成结构化计划 (Spec) -> 系统暂停。
- **Review (确认)**: 用户在 UI (Spec Editor) 上查看、修改、确认计划。
- **Runtime (执行)**: 用户点击执行 -> 系统调度内核执行 Spec。

### 1.2 "Dual Kernel" (双核架构)
- **Data Kernel (数据内核 - Python/Gateway)**: 负责逻辑执行、API 调用、数据处理。它不知道 UI 如何展示。
- **Render Kernel (渲染内核 - Frontend/Deeting)**: 负责将数据内核返回的 JSON 渲染为富交互组件 (Cards, Charts)。它不关心数据来源。

### 1.3 插件作用域 (Plugin Scopes)
区分基础设施与用户扩展，实现分层管理：

**A. 系统级插件 (System Scope)**
- **定位**: 核心基础设施或管理员工具。
- **管理**: 随系统部署/升级，用户不可卸载。
- **权限**: 较高权限（如直接数据库访问），通常仅管理员可见。
- **示例**: `core.crawler` (通用爬虫), `sys.provider_manager` (配置爬取与管理)。

**B. 用户级插件 (User Scope)**
- **定位**: 用户个性化扩展 (类似 VS Code Extensions)。
- **管理**: 用户自主安装/卸载/禁用。
- **权限**: 默认沙箱隔离，需显式授权（网络、文件等）。
- **示例**: `ext.stock_analysis` (股票分析), `ext.notion` (笔记同步)。

---

## 2. 架构组件 (Components)

### 2.1 插件系统 (The "Hand & Feet")
每个插件必须提供 **"一纸两码"**：
1.  **一纸 (Spec - `llm-tool.yaml`)**:
    -   标准的 OpenAI Function Calling 定义。
    -   让 LLM "感知" 插件能力。
    -   支持热插拔：会话开始前动态拼装 System Prompt。
2.  **一码 (Logic - `invoke()`)**:
    -   后端 Python 代码。
    -   输入参数 -> 执行业务逻辑 -> 返回 JSON。
    -   无副作用，无 UI 耦合。
3.  **一码 (View - `Renderer`)**:
    -   前端组件代码 (React/Vue/HTML)。
    -   接收 JSON -> 渲染界面。

### 2.2 编排与路由 (The "Brain & Router")
Gateway 的 Orchestrator 需要进化以支持分段执行：
1.  **Intent Recognition (意图识别)**:
    -   识别用户输入是简单对话还是复杂任务。
    -   如果需要工具，动态注入 `tools` 上下文。
2.  **Spec Generation (Spec 生成)**:
    -   如果 LLM 决定调用工具，**拦截执行**。
    -   将 LLM 的 `tool_calls` 转换为标准化的 `Spec Draft` JSON。
    -   返回给前端进行确认。
3.  **Spec Execution (Spec 执行)**:
    -   接收前端确认后的 Spec。
    -   `AgentExecutor` 按顺序调度插件的 `invoke()`。
    -   流式返回执行结果和状态。

---

## 3. 实施路线图 (Implementation Roadmap)

### Phase 1: 插件系统标准化 (Plugin Standardization)
- [ ] **重构 PluginManager**: 支持从 `llm-tool.yaml` 加载元数据。
- [ ] **统一 Invoke 接口**: 实现标准的 `invoke(plugin_name, tool_name, args)` 协议。
- [ ] **Registry 改造**: 支持动态生成 OpenAI 格式的 `tools` 列表。

### Phase 2: 编排层改造 (Orchestrator Evolution)
- [ ] **Context Injection**: 在 `RoutingStep` 中，根据上下文动态注入可用工具定义到 System Prompt。
- [ ] **Spec Interceptor**: 修改 `UpstreamCallStep` 或新增 `IntentStep`。当 LLM 返回 `tool_calls` 时，不再自动递归执行，而是构造 `SpecDraft` 响应并结束当前请求。
- [ ] **API 协议定义**: 定义前端与后端交互的 Spec JSON 格式。

### Phase 3: 执行引擎 (Execution Engine)
- [ ] **Spec Runtime**: 开发 `AgentExecutorService`，专门用于执行经用户确认的 Spec。
- [ ] **Stream Feedback**: 实现 SSE (Server-Sent Events) 接口，实时推送步骤状态 (Pending -> Running -> Success) 和数据结果。

### Phase 4: 前端集成 (Frontend Integration - Deeting)
- [ ] **Spec Editor**: 开发任务卡片组件，展示 Spec 步骤，支持删除/修改。
- [ ] **Visual Renderer**: 开发通用渲染容器，根据插件返回的 `render_type` 加载对应组件。

---

## 4. 示例工作流 (Example Workflow)

**场景**: "帮我调研 DeepSeek 并发到公司群"

1.  **User**: 输入指令。
2.  **Gateway (Planner)**:
    -   识别意图，发现需要 `search` 和 `im_sender` 工具。
    -   LLM 生成 Tool Calls。
    -   Gateway 拦截，返回 `Spec Draft`:
        ```json
        {
          "type": "spec_draft",
          "steps": [
            {"tool": "search", "args": {"q": "DeepSeek"}},
            {"tool": "im_sender", "args": {"target": "company_group"}}
          ]
        }
        ```
3.  **Frontend (Review)**:
    -   弹出 Spec Editor。
    -   **User Action**: 用户删除 "im_sender" 步骤（觉得太冒险）。
    -   **User Action**: 点击 "Execute"。
4.  **Gateway (Executor)**:
    -   接收修正后的 Spec。
    -   执行 `search` 插件。
    -   返回 Search Result JSON。
5.  **Frontend (Render)**:
    - 接收 Search Result。
    - 调用 `NewsCard` 组件渲染新闻列表。

## 5. 渲染内核与 UI 外挂 (Render Kernel)

### 5.1 核心理念
- **渲染器即插件**: UI 不写死在主程序中，而是作为独立的静态资源包 (HTML/JS/CSS)。
- **按需加载**: 内核根据数据类型动态加载对应的渲染器 (iframe/WebComponent)。
- **沙箱隔离**: 渲染器运行在受限环境中，通过标准消息总线通信。

### 5.2 Deeting Render Protocol (DRP)

#### 数据信封 (Data Envelope)
Data Kernel 返回的标准 JSON 格式：
```json
{
  "__render__": {
    "view_type": "stock.ohlc",  // 视图类型，内核据此路由到对应渲染器
    "title": "贵州茅台趋势分析",
    "payload": {               // 传给渲染器的原始数据
      "ticker": "600519",
      "data": [...]
    }
  }
}
```

#### 渲染器清单 (Renderer Manifest)
渲染插件的 `deeting.json`:
```json
{
  "name": "@deeting/renderer-lwc",
  "type": "renderer",
  "entry": "dist/index.html",
  "supported_views": ["stock.ohlc", "chart.line"]
}
```

### 5.3 通信 SDK (@deeting/ui-sdk)
内核与渲染器之间的双向通信桥梁：
- **Downstream (Kernel -> UI)**: `SET_DATA`, `THEME_CHANGE`, `RESIZE`
- **Upstream (UI -> Kernel)**: `USER_ACTION` (如点击图表), `REQUEST_DATA` (如请求更多历史数据)

### 5.4 示例：股票分析
1. **Plugin (Python)**: `ctx.push_stream({ "__render__": { "view_type": "stock.ohlc", ... } })`
2. **Kernel**: 识别到 `stock.ohlc` -> 查找已安装渲染器 -> 发现 `@deeting/renderer-lwc`。
3. **Frontend**: 
   - 动态创建 iframe，加载 `renderer-lwc/index.html`。
   - 通过 `postMessage` 发送 OHLC 数据。
4. **Renderer (iframe)**:
   - 使用 `LightweightCharts` 绘制 K 线。
   ## 6. 插件分发与生态 (Distribution & Ecosystem)
   
   ### 6.1 架构：Git-based Registry
   采用 "Git 即仓库、CI 即质检、CDN 即分发" 的去中心化架构。
   
   - **仓库 (Registry Hub)**: 一个专门的 GitHub 仓库 (`deeting-registry`) 存储插件元数据和 CI 配置。
   - **质检 (CI Pipeline)**: 
       - **Lint**: 校验 `deeting.json` 和 `llm-tool.yaml` 是否符合 Schema。
       - **Security**: 运行 `CodeQL` 和 `Dependency Check`。
       - **Smoke Test**: 在 Docker 沙箱中启动插件并执行一次 `invoke()` 验证。
   - **分发 (CDN Delivery)**: 
       - CI 通过后自动发布 GitHub Release。
       - 自动生成 `registry.json` 索引文件。
       - 利用 `jsDelivr` 等全球 CDN 进行加速分发。
   
   ### 6.2 客户端同步协议
   客户端不再直接访问插件源代码，而是通过 **增量同步** 维护本地插件库：
   1. **Fetch Index**: 客户端拉取 CDN 上的 `registry.json`。
   2. **Diff Check**: 比较本地已安装版本与远程最新版本。
   3. **Download**: 下载增量 `.zip` 包，支持断点续传。
   4. **Verify**: 校验文件 Hash (SHA-256) 和 GPG 签名，确保包未被中间人篡改。
   5. **Hot-Swap**: 解压并热重载插件，无需重启应用。
   
   ### 6.3 开发者工作流
   ```bash
   $ deeting publish
   ✔ 自动升级 SemVer 版本
   ✔ 生成本地签名校验
   ✔ 提交 Pull Request 到官方仓库
   ```
   
   ---
   
   ## 7. 最终目标：DeetingOS 生态闭环
   
   通过上述架构，DeetingOS 实现了：
   1. **大脑可配置**: 随时切换不同的 LLM 模型。
   2. **手脚可扩展**: 通过插件商店下载任意技能（天气、股票、PDF 处理等）。
   3. **交互可视化**: UI 外挂确保每个技能都有专业的渲染界面。
   4. **过程透明化**: Spec Agent 让用户审批计划，解决信任问题。
   5. **分发自动化**: 全球 CDN 确保插件生态可以像 VS Code 插件一样繁荣自转。
