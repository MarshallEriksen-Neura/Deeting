# Deeting Scout (The Cognitive Engine)

Scout 是 Deeting OS 的主动侦察与知识摄取子系统。

## 核心使命
Scout 不仅仅是一个爬虫，它是系统的“感官延伸”。它的任务是从互联网的噪音中提取结构化的“技能”和“知识”，并将其转化为系统的长期记忆。

## 架构职责
1.  **Watchtower (瞭望塔)**: 监控技术趋势和更新。
2.  **Deep Diver (深潜者)**: 深度递归爬取文档，构建知识图谱。
3.  **Troubleshooter (排查员)**: 基于错误日志的解决方案搜索。
4.  **Skill Forger (铸造师)**: 自动化工具生成。

## 技术栈
- **Runtime**: Python 3.12
- **Browser Engine**: Playwright (via Crawl4AI)
- **Framework**: FastAPI (Control Plane)
- **Storage**: Qdrant (Vector Memory), Redis (Task Queue)
