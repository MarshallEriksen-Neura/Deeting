# Claude 前端协作备忘

面向 Claude / LLM 生成前端代码的注意事项，确保输出符合 Deeting “Digital Ink” 设计（见 `ui-prompt.md`）与 Next.js 14 / React 最佳实践。

## 设计基调（遵循 ui-prompt）
- 背景用雾感浅灰/米白 (`#F7F9FB` / `#FAFAFA`)，卡片纯白无边框，柔和弥散阴影塑造悬浮感。
- 文本采用墨色层级（Strong `#1F2937` / Medium `#4B5563` / Light `#9CA3AF`），强调色仅用 Digital Blue `#2563EB`、错误用 Zen Red `#EF4444`。
- 玻璃态：顶部/侧边栏可用 `backdrop-filter: blur(8-12px)` 搭配 `bg-white/80`。
- 动效轻盈：卡片/按钮 300ms ease-out 过渡，点击轻微缩放；列表/卡片入场分批错峰。

## 交互模式：大屏 vs 小屏
- 优先为移动端设计线性流程，再为大屏做渐进增强。
- Dialog：
  - 桌面端可用居中 Dialog 处理确认、小表单、详情补充。
  - 移动端避免小窗；简单确认用底部动作条（Bottom Sheet），表单/详情跳新页面或全屏 Dialog，支持手势下滑关闭。
- Drawer：
  - 桌面端用于侧边导航/筛选/工具栏。
  - 移动端仅保留主导航汉堡抽屉；筛选/工具栏改为独立页面或底部 Sheet；消息列表跳转消息页。
- 导航与密度：保持 1280-1440px 内容宽度上限，大屏留白；小屏确保拇指热区，底部主操作优先。

## 组件拆分与文件组织
- 页面默认 Server Component；含状态/事件/浏览器 API 的部分拆到 `"use client"` 子组件（放 `components/**`）。
- 复用 `@/components/ui`（shadcn）与现有业务组件，避免裸 HTML + Tailwind 堆砌。
- 逻辑分层：容器组件拉取数据 + 纯展示组件渲染，列表/表格可再拆行项组件以便 memo。

## 性能与按需加载
- 默认 RSC，减少客户端 JS；客户端组件使用 `React.memo`/`useMemo`/`useCallback` 控制重渲染。
- 对非首屏/低频交互组件使用 `React.lazy` + `Suspense` 或 Next.js `dynamic(() => import(...), { ssr: false/true })` 进行分块加载；避免把核心导航、首屏骨架懒加载。
- 长列表使用虚拟滚动（如 `@tanstack/react-virtual`）；图片用 `next/image`，表格/图表谨慎引入大库。

## Next.js / React 实践
- 路由文件保持最小逻辑，只做数据装载与布局；副作用封装在 hooks 中。
- 数据获取优先使用现有 SWR 封装（`@/lib/swr`），避免裸 `fetch`。类型定义集中在 `frontend/lib/api-types.ts`。
- 统一 i18n：所有文案走 `useI18n()` key，不写死字符串；新增 key 同步中英。
- 避免在客户端直接操作 DOM；动画用 CSS 或轻量 motion 库，保证可访问性（焦点管理、`aria-*`）。

## Tauri 移植注意
- 运行模式：Tauri WebView 默认无 Node/Edge SSR 环境，尽量让页面可静态导出或仅依赖浏览器 API；避免强制 `force-dynamic` 的 Server Action/Route Handler。必要时由 Rust 后端提供本地 API，再通过 `invoke` 调用，少开本地 HTTP 服务。
- 预取与导航：`next/link` 的服务端预取在打包为本地静态资源时收益有限；对首屏/核心路由保留静态资源，次要页面可用 `dynamic import` 或 `React.lazy` 分块，确保初始包小。
- 存储与文件：配置下载/缓存等改为 Tauri 插件（`tauri-plugin-store`、`tauri-plugin-fs`/`dialog` 等），不要假设浏览器能直接访问本地路径；路径使用 Tauri API 获取 app 目录。
- 权限与安全：禁用 `window.open` 外跳；资源应随包内置或走可信域名。慎用内联 eval/`dangerouslySetInnerHTML`，遵守 CSP；剪贴板/通知走 Tauri 提供的安全接口。
- 窗口与响应式：桌面端可利用可调整窗口、系统菜单，但保持小屏（窄窗口）可用性；对话框/抽屉策略同上，小窗口等同移动端处理。
- 观测与日志：浏览器控制台日志会进入宿主端；敏感信息写入 Rust 侧日志时需脱敏。崩溃/异常可通过 `tauri::api::notification` 或自建上报通道收集。

## 设计取舍速查（对话框/抽屉）
- 删除/确认：桌面 Dialog；移动 Bottom Sheet。
- 简单创建：桌面 Dialog；移动全屏 Dialog 或新页面。
- 复杂编辑/长表单：全部跳新页面（两端一致）。
- 筛选/工具：桌面右侧 Drawer；移动筛选页或底部 Sheet。
- 消息/通知：桌面 Drawer 可；移动跳消息中心页。

## 交付自检
- 样式、动效、留白符合 `ui-prompt.md`；无纯黑边框/文字。
- 首屏不被懒加载阻塞；移动端触达核心操作不依赖悬浮 Dialog/Drawer。
- 组件目录、i18n key、SWR Hook、类型声明同步更新；必要时补充/更新对应测试与文档。
