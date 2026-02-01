# Admin Sidebar Navigation Design (Global Admin)

## 背景与目标
本设计定义管理后台左侧导航结构，面向“全局管理员（admin 角色）”，与
`backend/docs/design-knowledge-review-ui.md` 的 Admin UI Scope 对齐，并为概览/监控扩展预留位置。
目标是：让管理员以“看什么→管什么→改什么”的心智路径快速定位页面。

## 导航结构（建议）
一级入口保持精简，二级菜单按业务对象与任务动词命名。

### 1) 概览
- 概览（Dashboard）

### 2) 监控
- 监控（Monitoring）

### 3) 内容与知识
- 助手管理
- 助手审核&标签
- Spec 知识审核
- 知识审核工作台

### 4) 访问与安全
- 用户管理
- API Key
- API Key 限流
- 注册窗口/邀请码

### 5) 系统与运营（含 Provider 子菜单）
- Provider 实例（BYOP）
- Provider 预设
- Provider 凭证
- Embedding 设置
- 通知

## 路由与接口映射（已知）
以下 API 已在文档或路由中明确：
- 助手管理：`/admin/assistants`
- 助手审核&标签：`/admin/assistant-reviews`
- Spec 知识审核：`/admin/spec-knowledge-candidates`
- 知识审核工作台：`/admin/knowledge/reviews`
- Provider 实例：`/admin/provider-instances`
- Embedding 设置：`/admin/settings/embedding`
- 通知：`/admin/notifications`
- 注册窗口/邀请码：`/admin/registration`
- API Key 限流：`/admin/api-keys/{id}/rate-limit`

概览/监控的数据来源可先复用现有 `/dashboard`、`/monitoring` 路由；
若需要更高维度或跨租户聚合，可参考 `backend/docs/credits-design.md` 中
`/api/v1/admin/metrics/*` 规划，后续再补充实现。

## 权限与可见性
- 后端强校验：对 admin 页面/API 统一使用 `require_permissions`；
  admin 角色默认授予所有后台权限。
- 前端弱校验：左侧导航仅对 admin 展示；若未来细分权限，可对二级菜单做权限隐藏，
  并提供“无权限”提示页，避免入口消失导致用户迷失。

## 交互增强（可选）
- 审核队列、失败告警等可在一级入口右侧展示待处理数量（来自接口数据，权限不足则为空）。
