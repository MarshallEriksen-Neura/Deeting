# Root README 落地页设计

## 目标

把根目录 `README.md` 从“工程安装说明”改成“GitHub 产品落地页”，优先服务第一次进入仓库、准备下载或快速判断产品价值的用户。

## 受众

1. 路过 GitHub、只想判断要不要下载的人
2. 对“本地优先 AI 桌面工作台”感兴趣的重度 AI 用户
3. 愿意进一步查看技术架构与开发入口的开发者

## 设计原则

- 首屏先讲价值，不先讲工程结构
- 下载入口要比开发命令更靠前
- 文案要像产品，不像内部实施说明
- 开发者内容保留，但折叠到后面
- 视觉图使用 SVG，自带品牌感，不依赖外部截图

## 信息结构

1. Header 区
   - Logo
   - 中英文标题
   - 下载入口
   - 本地品牌 badge 行
2. Hero 区
   - 一张主视觉 SVG
   - 一段“它不只是聊天客户端”的定位文案
3. 开源信号区
   - Star History
4. 硬能力区
   - 巡猎 + 定时任务 + 飞书回流
   - Bandit 反馈抉择
   - 模板映射 / output mapping
   - 语义 Assistant 路由
   - Memory fact 抽取与生命周期治理
5. 反馈闭环图区
   - Bandit feedback loop SVG
6. 价值判断区
   - 3 个和普通聊天客户端的差别
7. 视觉说明区
   - 本地优先架构 SVG
   - 工作流闭环 SVG
8. 快速开始区
   - 按操作系统给下载提示
   - 首次启动 4 步
9. 路线图区
10. 开发者折叠区

## 视觉方向

- 深色科技底
- 延续仓库现有紫金品牌倾向
- 图形表达围绕“网关、流动、闭环、上下文”
- 不做过多 UI 假截图，避免显得像空壳营销图

## 交付物

- `README.md`
- `docs/images/readme/deeting-hero.svg`
- `docs/images/readme/deeting-privacy.svg`
- `docs/images/readme/deeting-workflow.svg`
- `docs/images/readme/icon-hunt-feishu.svg`
- `docs/images/readme/icon-bandit-loop.svg`
- `docs/images/readme/icon-template-map.svg`
- `docs/images/readme/icon-assistant-route.svg`
- `docs/images/readme/icon-memory-facts.svg`
- `docs/images/readme/badge-release.svg`
- `docs/images/readme/badge-open-source.svg`
- `docs/images/readme/badge-platform.svg`
- `docs/images/readme/badge-tauri.svg`
- `docs/images/readme/badge-bandit.svg`
- `docs/images/readme/deeting-bandit-feedback.svg`

## 验收标准

- 根 README 第一屏能直接回答“这是什么”和“去哪里下载”
- 根 README 第二屏能直接看到 Star History 与硬能力，不再只有泛化卖点
- README 顶部 badge 不再依赖通用外链风格，视觉上更像同一产品语言
- README 中不再以开发说明作为前半部分主体
- 所有图片均为仓库内相对路径 SVG，可在 GitHub 中直接渲染
- 开发命令仍然保留，但不打断普通用户阅读
