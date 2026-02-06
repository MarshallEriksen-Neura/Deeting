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

## 前端 UI 框架使用规范


- 组件复用与 shadcn
  - **组件使用优先级**（从高到低）：
    1. **优先使用 shadcn/ui 官方组件**：通过 `bunx shadcn@latest add <component>` 安装到 `@/components/ui`，例如 `button`, `card`, `dialog`, `input`, `select`, `table` 等。
    2. **复用已封装的业务组件**：使用 `@/components/dashboard`、`@/components/layout`、`@/components/forms` 等目录下已有的业务组件。
    3. **最后才考虑自定义封装**：只有在 shadcn/ui 没有提供对应组件，且现有业务组件无法满足需求时，才在 `@/components/ui` 中封装新的通用组件。
  - 新增或修改前端页面时，**禁止直接使用原生 HTML 标签**（如 `<button>`, `<input>`, `<select>`）堆叠 Tailwind class，必须使用 `@/components/ui` 中的组件。
  - 使用 Card 组件时，优先使用 `@/components/ui/card` 中的 `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` 等组件，保持卡片样式统一。
  - AI Agent 可以通过 **shadcn MCP** 查询/检索组件用法和示例代码。

- 路由结构与组件拆分
  - `frontend/app/**/page.tsx` 默认应为 **服务端组件**（不加 `"use client"`），负责页面布局和数据装载；有复杂交互或状态管理时，将交互逻辑拆到 `components/*-client.tsx` 等客户端组件中。
  - 客户端组件必须显式声明 `"use client"`，并放在 `frontend/components/**` 或 `frontend/app/**/components/**` 下，避免把所有逻辑堆在 page 文件里。
  - 复用 `@/components/layout/*` 等现有导航和布局组件，统一仪表盘、系统管理区的布局结构。
  - **新增/修改 UI 时，组件必须按功能拆分**（例如：数据获取容器、模型选择器、历史按钮、设置面板等分别成独立组件），禁止把多个功能耦合在同一组件文件里。

- API 请求与 SWR 封装
  - 前端访问后端时，应优先使用已封装好的 SWR 层：`@/lib/swr`（如 `useApiGet`, `useApiPost`, `useResource`, `useCreditBalance`, `useCreditTransactions` 等），**不要在组件中直接调用裸 `fetch` 或裸 `axios`**。
  - 新增业务场景时，优先在 `frontend/lib/swr` 中按领域增加专用 Hook（参考 `use-credits.ts`, `use-provider-keys.ts`, `use-private-providers.ts` 等），再在组件中消费这些 Hook。
  - 与后端交互的类型统一在 `frontend/lib/api-types.ts` 中维护；新增或调整 API 时，先补充 / 更新对应 TypeScript 类型，再在 SWR Hook 和组件中引用。
  - 应用根布局已在 `frontend/app/layout.tsx` 中挂载 `SWRProvider`，页面和组件无需重复包裹 Provider。

- 国际化（i18n）规范
  - 所有用户可见文案必须通过 `useI18n()` 使用文案 key，而不是直接写死中文或英文字符串。
  - 新增页面或模块时，在 `frontend/lib/i18n/*.ts` 中对应的模块文件里补充多语言文案，并在 `frontend/lib/i18n/index.ts` 中合并导出（参考现有 `credits`, `providers`, `routing` 等模块）。
  - 导航、按钮、对话框标题等通用文案优先复用已存在的 key，避免重复定义；如需新增 key，请保证中英文都补齐。

- 性能与体验优化
  - 列表 / 表格类页面应使用分页或搜索 Hook（如 `usePaginatedData`, `useSearchData`）或带分页参数的 SWR Hook，避免一次性加载过多数据。
  - 合理选择 SWR 缓存策略：读多写少的数据使用 `static`，频繁更新的数据使用 `frequent` 或 `realtime`，并避免在每次渲染时创建新的 key 对象（尽量使用 `useMemo` 组合查询参数）。
  - 大型组件拆分为“容器组件（负责数据获取）+ 展示组件（只负责渲染）”，减少重复渲染和状态耦合。
  - 避免在客户端组件中做重计算或复杂 DOM 操作；能在服务端完成的数据准备放在 page 的服务端逻辑里完成，减轻客户端负担。
