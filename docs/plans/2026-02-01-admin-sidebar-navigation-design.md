# Admin Sidebar Navigation Design (Global Admin)

> 状态：已落地，当前仅保留简要说明。
> 更新时间：2026-03-06

## 当前结论
- 管理后台导航分组、路由映射和侧边栏组件已经进入现行实现。
- 本文件不再维护信息架构推演过程，仅保留状态说明。

## 当前实现入口
- 管理端导航真源：`deeting/components/layout/sidebar/navigation-config.ts`
- 侧边栏组件：`deeting/components/layout/sidebar/glass-sidebar.tsx`
- 管理端布局接入：`deeting/app/[locale]/admin/layout.tsx`
- 已落地页面示例：`deeting/app/[locale]/admin/monitoring/page-content.tsx`
- 已落地页面示例：`deeting/app/[locale]/admin/skills/page-content.tsx`
- 已落地页面示例：`deeting/app/[locale]/admin/provider-instances/page-content.tsx`

## 维护说明
- 后续新增后台菜单时，请直接修改导航配置并同步页面路由。
- 不再回写本历史设计稿的分组讨论细节。
