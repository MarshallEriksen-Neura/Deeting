# Deeting Plugin Developer Guide

## 1. 简介 (Introduction)
Deeting 插件是扩展 DeetingOS 能力的核心方式。每个插件都是一个独立的包，包含后端逻辑 (Data Kernel) 和可选的前端展示 (Render Kernel)。

插件遵循 **"一纸两码"** 架构：
1.  **Manifest & Spec (一纸)**: 定义插件元数据和 LLM 能力。
2.  **Logic (一码)**: 后端 Python 代码，负责业务逻辑。
3.  **UI (一码)**: 前端 HTML/JS 代码，负责界面渲染。

---

## 2. 目录结构 (Directory Structure)

一个标准的插件包 (e.g., `stock-analysis`) 结构如下：

```text
stock-analysis/
├── deeting.json          # [必须] 插件清单 (Manifest)
├── llm-tool.yaml         # [必须] LLM 工具定义 (Spec)
├── main.py               # [必须] 后端入口文件
├── requirements.txt      # [可选] Python 依赖
├── ui/                   # [可选] 前端资源目录
│   ├── index.html        # 渲染器入口
│   └── style.css
└── README.md             # 说明文档
```

---

## 3. 核心文件详解

### 3.1 清单文件 (`deeting.json`)
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
    "llm_tool": "llm-tool.yaml" // 注册给 LLM 的工具定义
  }
}
```

### 3.2 LLM 工具定义 (`llm-tool.yaml`)
告诉 LLM 这个插件能做什么。遵循 OpenAI Function Calling 格式。

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

### 3.3 后端逻辑 (`main.py`)
核心业务逻辑。插件必须实现 `invoke` 方法。

```python
from deeting.sdk import PluginContext, stream_result

# 激活钩子 (可选)
def on_activate(ctx: PluginContext):
    print(f"Stock plugin activated for user {ctx.user_id}")

# 核心调用入口
async def invoke(tool_name: str, args: dict, ctx: PluginContext):
    if tool_name == "get_stock_trend":
        symbol = args["symbol"]
        
        # 1. 执行业务逻辑 (调用外部 API)
        # 注意：需使用 ctx.http_client 以遵循系统代理/审计规则
        data = await ctx.http_client.get(f"https://api.stock.com/v1/{symbol}")
        
        # 2. 返回渲染指令 (Data Envelope)
        # 这会触发前端加载 ui/index.html 并渲染数据
        return {
            "__render__": {
                "view_type": "stock.trend",
                "title": f"Analysis: {symbol}",
                "payload": {
                    "symbol": symbol,
                    "prices": data.json()
                }
            }
        }
```

### 3.4 前端渲染 (`ui/index.html`)
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
    - 编写 `llm-tool.yaml` 定义接口。
    - 编写 `main.py` 实现逻辑。
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
*   **Security**: 不要尝试绕过沙箱。所有网络请求必须走 `ctx.http_client`。
*   **UI Performance**: 渲染器应轻量化。尽量使用 CDN 资源，避免打包过大的依赖。
*   **Error Handling**: 遇到错误时，返回友好的错误信息，而不是抛出异常。
