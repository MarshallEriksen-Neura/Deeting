# Deeting Scout (侦察兵)

**The Cognitive Engine for AI Operating Systems.**

Scout 是一个独立的微服务，旨在赋予 AI 系统“主动视觉”能力。它不仅能抓取网页，还能对抗反爬、过滤合规风险，并递归构建网站知识图谱。

## ✨ 核心特性

*   **🕵️ 隐形侦察 (Stealth)**: 内置反指纹技术，模拟人类行为，轻松绕过大多数反爬检测。
*   **🛡️ 合规防火墙 (Compliance)**: 域名黑名单与内容敏感词双重过滤，确保抓取内容安全合法。
*   **🧠 深度潜入 (Deep Dive)**: 给定一个 URL，自动递归爬取整站文档，生成拓扑结构。
*   **🔌 纯粹无状态**: 不依赖数据库，不依赖 Redis。只做“输入 URL -> 输出 Markdown”的纯粹计算。

## 🚀 快速开始

### 方式一：Docker (推荐)

```bash
docker build -t deeting-scout .
docker run -d -p 8001:8001 deeting-scout
```

### 方式二：本地运行 (Python 3.12+)

1.  **安装依赖**
    ```bash
    pip install .
    ```

2.  **安装浏览器内核** (首次运行必须)
    ```bash
    playwright install chromium
    playwright install-deps chromium # Linux Only
    ```

3.  **启动服务**
    ```bash
    python main.py
    ```

服务将启动在 `http://0.0.0.0:8001`。

## 📡 API 接口

### 1. 单页侦察 (`POST /v1/scout/inspect`)

获取单个页面的干净 Markdown 内容。

```bash
curl -X POST "http://localhost:8001/v1/scout/inspect" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://example.com", "js_mode": true}'
```

### 2. 深度潜入 (`POST /v1/scout/deep-dive`)

递归爬取整站。

```bash
curl -X POST "http://localhost:8001/v1/scout/deep-dive" \
     -H "Content-Type: application/json" \
     -d '{ 
           "url": "https://docs.pydantic.dev/", 
           "max_depth": 2, 
           "max_pages": 10
         }'
```

## 🛠️ 配置

支持通过环境变量调整行为：

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `MAX_CONCURRENT_CRAWLS` | 5 | 最大并发任务数 |
| `DEFAULT_USER_AGENT` | DeetingScout/1.0 | 默认 UA |

## 📦 独立部署指南

本项目设计为完全解耦的微服务。您可以将其部署在：
*   **独立的 VPS**: 获得独立的海外 IP，避免影响主业务。
*   **Serverless**: 支持部署到 Google Cloud Run 或 AWS Cloud Run（需使用 Docker 镜像）。
*   **K8s Cluster**: 作为一个 Deployment 运行，支持横向扩展。