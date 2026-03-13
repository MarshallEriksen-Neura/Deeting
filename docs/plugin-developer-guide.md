# Deeting Plugin Developer Guide

## 1. 简介 (Introduction)
Deeting 插件是扩展 DeetingOS 能力的核心方式。每个插件都是一个独立的包，包含后端逻辑 (Data Kernel) 和可选的前端展示 (Render Kernel)。

插件遵循 **"Tool-first + Runtime/UI"** 架构：
1.  **Tool Contract**: 通过 `llm-tool.yaml`（或宿主生成的等价 schema）声明可调用工具，供 MCP/Host 注册。
2.  **Logic**: 后端 Python 代码，负责业务逻辑。
3.  **UI**: 可选前端 HTML/JS 代码，负责界面渲染。
4.  **Skill Docs**: `SKILL.md` 用于能力说明、边界和使用建议，不作为脚本执行入口。

---

## 2. 目录结构 (Directory Structure)

一个标准的插件包 (e.g., `stock-analysis`) 结构如下：

```text
stock-analysis/
├── SKILL.md              # [推荐] 语义说明与使用边界（非执行入口）
├── deeting.json          # [必须] 插件清单 (Manifest)
├── llm-tool.yaml         # [推荐] 可调用工具契约 (MCP/Host Tool Schema)
├── main.py               # [必须] 后端入口文件
├── requirements.txt      # [可选] Python 依赖
├── ui/                   # [可选] 前端资源目录
│   ├── index.html        # 渲染器入口
│   └── style.css
└── README.md             # 说明文档
```

---

## 3. 核心文件详解

### 3.1 Skill 文档 (`SKILL.md`)
这是语义与策略文档，负责描述：

- 技能做什么
- 何时使用
- 何时不要使用
- 关键能力与约束

注意：`SKILL.md` 不是执行契约。可调用能力必须通过工具 schema 暴露给宿主。

### 3.2 清单文件 (`deeting.json`)
插件的身份证，定义基本信息、权限和入口。

```json
{
  "id": "com.example.stock",
  "name": "Stock Master",
  "version": "1.0.0",
  "scope": "user",            // "user" 或 "system"
  "description": "Professional stock analysis tool.",
  "permissions": [            // 申请权限
    "network.outbound"        // 允许访问外网
  ],
  "entry": {
    "backend": "main.py",     // 后端入口
    "renderer": "ui/index.html" // 前端入口 (可选)
  },
  "capabilities": {
    "llm_tool": "llm-tool.yaml" // [可选] 如不提供需由宿主生成等价 callable schema
  },
  "installation": {
    "dependencies": ["httpx>=0.27.0"] // [可选] 运行前 pip install 的依赖列表
  }
}
```

### 3.3 Host 工具定义 (`llm-tool.yaml`)
该文件（或等价自动生成 schema）用于定义可调用工具契约，是 MCP/Host 注册 callable tools 的直接来源。

```yaml
name: get_stock_trend
description: "Get stock price trend and technical analysis."
parameters:
  type: object
  properties:
    symbol:
      type: string
      description: "Stock symbol (e.g., 'AAPL', '600519')."
    period:
      type: string
      enum: ["1d", "1w", "1m"]
      default: "1m"
  required: ["symbol"]
```

### 3.4 后端逻辑 (`main.py`)
核心业务逻辑。插件入口必须实现 `async def invoke(tool_name, args, deeting)`。

```python
async def invoke(tool_name: str, args: dict, deeting):
    if tool_name == "get_stock_trend":
        symbol = args["symbol"]
        
        # 1. 执行业务逻辑 (调用外部 API)
        # 推荐通过 deeting.call_tool 调用系统已注册工具
        # （例如：搜索、数据库、工作流工具等）
        data = deeting.call_tool("fetch_web_content", url=f"https://api.stock.com/v1/{symbol}")
        
        # 2. 返回渲染指令 (Data Envelope)
        # 这会触发前端加载 ui/index.html 并渲染数据
        return {
            "__render__": {
                "view_type": "stock.trend",
                "title": f"Analysis: {symbol}",
                "payload": {
                    "symbol": symbol,
                    "prices": data
                }
            }
        }
```

### 3.5 前端渲染 (`ui/index.html`)
运行在沙箱 (iframe) 中的静态页面。

```html
<!DOCTYPE html>
<html>
<head>
    <!-- 引入 Deeting UI SDK -->
    <script src="/sdk/ui.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <canvas id="myChart"></canvas>
    
    <script>
        // 1. 监听数据事件
        DeetingRender.onData((envelope) => {
            const { payload } = envelope;
            renderChart(payload.prices);
        });

        // 2. 监听主题切换
        DeetingRender.onThemeChange((theme) => {
            // 'light' or 'dark'
            updateChartTheme(theme);
        });

        function renderChart(data) {
            // 使用 Chart.js 绘图...
        }
    </script>
</body>
</html>
```

---

## 4. 开发流程 (Workflow)

1.  **初始化**: `deeting create plugin my-plugin`
2.  **开发**: 
    - 先定义可调用工具契约（`llm-tool.yaml` 或等价 schema）。
    - 编写 `deeting.json` 声明 metadata/runtime/UI 入口。
    - 编写 `main.py` 实现逻辑。
    - 补充 `SKILL.md` 描述能力、规则和边界。
    - 编写 `ui/index.html` 实现界面。
3.  **调试**: 
    - 运行 `deeting dev` 启动本地调试模式。
    - Gateway 会加载本地插件目录。
    - 在 Deeting 聊天窗口输入测试指令。
4.  **发布**: 
    - `deeting pack` 打包为 `.zip`。
    - 上传至插件市场 (Registry)。

---

## 5. 最佳实践 (Best Practices)

*   **Stateless**: 插件后端应尽量无状态。如需存储数据，请使用 `ctx.storage` (KV Store) 或 `ctx.memory` (Vector Store)。
*   **Runtime SDK**: 运行时会注入 `deeting` 对象，支持 `deeting.log()`、`deeting.section()`、`deeting.call_tool()`、`deeting.render()`。
*   **Security**: 不要尝试绕过沙箱。优先通过 `deeting.call_tool` 调用平台能力，而不是自行直连内部服务。
*   **UI Performance**: 渲染器应轻量化。尽量使用 CDN 资源，避免打包过大的依赖。
*   **Error Handling**: 遇到错误时，返回友好的错误信息，而不是抛出异常。
*   **Scope Safety**: 涉及“生成系统级资源”的工具参数（如 `target_scope=system`）必须在后端做管理员校验，禁止仅依赖前端或提示词约束。
*   **Render Contract**: 推荐通过 `{"__render__": {"view_type": "...", "payload": {...}}}` 返回 UI 渲染块。Code Mode 下 `deeting.render(...)` 会自动转换为同类 `ui.blocks` 协议并透传到前端。
*   **Typed SDK**: Code Mode 运行时会动态注入 `deeting_sdk.pyi/.py`，可直接 `from deeting_sdk import <tool_name>` 并获得更稳定的参数签名提示。
*   **Observability Contract**: 如需调试回放，建议在 `tool_result.debug` 查看运行时摘要（`runtime_tool_calls` / `render_blocks` / `sdk_stub`）；其中 `runtime_tool_calls.calls[]` 提供步骤级 `duration_ms` 与错误信息字段，便于定位慢调用和失败点。
*   **Callable Contract**: 可调用能力必须可被宿主注册为 tool（`llm-tool.yaml` 或等价 schema）。`SKILL.md` 仅用于说明，不应替代工具契约。
*   **Dependency Install Order**: 运行时会先安装 `deeting.json.installation.dependencies`，再检测并执行 `pip install -r requirements.txt`（若文件存在）。
