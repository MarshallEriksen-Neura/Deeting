# 用户相关 API 设计草案

## 背景与目标
- 当前仅存在基于请求头 `X-User-Id` 的简易鉴权依赖（见 `app/deps/auth.py`），缺少用户自助注册/登录、角色权限查询与管理接口。
- 目标：在保持现有依赖可用的前提下，补齐用户体系接口，明确性能优化点，并规划 Redis 缓存/会话的存储策略。
- 非目标：本稿不落地具体代码实现与数据库迁移，只做范围与接口层级设计，便于后续拆分任务实现。

## 功能范围（MVP → 增量）
1. 认证登录
   - 登录：`POST /api/v1/auth/login`（email + password），返回 access_token（短 TTL）、refresh_token（长 TTL）及用户概要。
   - 刷新：`POST /api/v1/auth/refresh` 使用 refresh_token 获取新 access_token。
   - 登出：`POST /api/v1/auth/logout` 使当前 access_token + 对应 refresh_token 失效（Redis 记录黑名单或版本号）。
   - 兼容：保留 `X-User-Id` 头部解析，允许在内网/灰度阶段绕过登录接口（后续可逐步下线）。

2. 用户自助能力
   - 注册：`POST /api/v1/users/register`（email + password，开启注册控制时必须 invite_code），创建用户并按窗口 `auto_activate` 决定激活，必要时发送验证邮件/验证码。
   - 激活/找回：`POST /api/v1/users/activate` / `POST /api/v1/users/reset-password` 通过验证码完成激活或重设密码。
   - 个人信息：`GET /api/v1/users/me` 返回基础信息、角色列表、权限 flags（复用 `get_permission_flags`），`PATCH /api/v1/users/me` 允许修改展示名、头像等非敏感字段。
   - 修改密码：`POST /api/v1/users/me/change-password`（旧密码 + 新密码）。

3. 管理端（需管理员/特定权限）
   - 用户列表：`GET /api/v1/admin/users` 支持 email/状态/角色筛选，分页返回。
   - 用户管理：`POST /api/v1/admin/users` 创建用户；`PATCH /api/v1/admin/users/{user_id}` 更新状态（启用/禁用）、重置密码；`DELETE /api/v1/admin/users/{user_id}` 逻辑禁用。
   - 角色/权限：`GET /api/v1/admin/roles`、`GET /api/v1/admin/permissions`；`POST /api/v1/admin/users/{user_id}/roles` 绑定/解绑角色。
   - 审计：登录失败、密码修改、角色变更等事件落审计日志（可复用 gateway 日志或新增表，待实现时细化）。
   - 封禁/解封：`POST /api/v1/admin/users/{user_id}/ban`（携带封禁类型、原因、可选截止时间）与 `POST /api/v1/admin/users/{user_id}/unban`，生效后立即失效既有 token/权限缓存。
   - 注册控制：`POST /api/v1/admin/registration/windows` 创建注册窗口（开始/结束、名额、auto_activate），`/invites` 生成/查询邀请码。

4. 授权与可见性协同
   - API 依赖统一使用 `require_permissions` 与 `can_use_item/assert_can_use_item`（参见 `app/deps/auth.py`），避免在 handler 内散落判断。
   - 权限 code 设计沿用现有 `permission.code`，前端需要全量 flags 时通过 `KNOWN_PERMISSION_CODES` 兜底。

## 设计与优化方向
- 分层与仓库：继续使用 Repository + Service 分层，用户/角色/权限访问统一走 `UserRepository`，避免在路由层直接写 ORM。
- 密码与安全：`hashed_password` 使用 bcrypt/argon2；返回 DTO 必须排除敏感字段；登录失败计数与验证码校验放 Redis，防暴力破解。
- Token 方案：优先 JWT（内含 jti 与 user_id）；access 短期 15–30 分钟，refresh 7–30 天；支持基于 jti 的黑名单/版本号失效。
- 性能与缓存：用户基础信息与权限列表可短期缓存（Redis），减少 DB 查询；列表接口分页 + 索引（email, is_active）。
- 兼容迁移：保留 header 透传方案，新增 JWT 后在 `get_current_user` 中优先解析 Authorization: Bearer，未提供则回退 `X-User-Id`。
- 可观测性：登录、权限拒绝、角色变更写结构化日志，便于审计与风控。
- 测试策略：为登录/刷新、权限拒绝/放行、缓存命中/失效、限流场景编写合成测试；兼容 header 模式的回归用例。
- 封禁策略：支持永久封禁与临时封禁（带截止时间）；鉴权入口统一检查封禁状态，返回 403/423；封禁事件触发 token 失效与 Redis 缓存清理，解封需清理封禁标记。
- MFA 与密码策略：登录/改密/解绑 MFA 时可要求短信/邮件/OTP 二次校验；密码强度校验、历史密码不重用，连续失败触发短期封禁或验证码。
- 租户/组织隔离（如有 B2B）：user/role/permission 绑定 tenant_id，权限/可见性过滤携带 tenant_id，唯一约束与索引按 tenant 维度设计。
- 额度与计费协同：余额/配额冻结-结算-释放流程；赠送/补偿/过期字段与流水类型预留；余额读取可短缓存，扣减需乐观锁或行锁。
- 反滥用：登录、验证码、重置密码按 IP+账号限流（Redis 计数）；IP/UA/设备黑名单与申诉流程；验证码发送频率控制。
- 审计与合规：关键操作审计 who/when/what（含前后 diff/原因）；账号删除/停用流程与数据导出；邮箱等 PII 脱敏展示；统一错误码与错误体。
- 长连接与踢下线：WS/SSE 需携带 token，封禁/登出/token_version 变更时可通过 Redis pubsub 或版本号策略即时踢出。

## Redis 使用规划
- 连接复用：沿用 `app/core/cache.py` 与 `settings.CACHE_PREFIX`；所有键统一前缀 `ai_gateway:`（可配置）。
- 键空间与 TTL 建议：
  - `auth:access:{jti}`：存 access_token 绑定的 user_id + 过期时间（与 token TTL 一致）；注销或服务端撤销时删除或标记为失效。
  - `auth:refresh:{jti}`：refresh_token 绑定 user_id、当前 token_version，TTL 7–30 天；旋转刷新时旧 jti 标记为已用/失效，防止重放。
  - `auth:token_version:{user_id}`：记录用户当前 token 版本，更新密码/强制登出时自增，使旧 jti 全部失效。
  - `auth:login_fail:{email}`：登录失败计数，TTL 10–30 分钟，触发阈值后需要验证码或短暂封禁。
  - `auth:captcha:{email}` / `auth:reset_code:{email}`：注册/找回验证码，TTL 5–10 分钟，单次验证后删除。
  - `acl:perm:{user_id}`：缓存权限 code 列表或 flags，TTL 5–15 分钟；用户角色变更时主动清除。
  - `session:ctx:{user_id}`（可选）：面向聊天会话的轻量上下文（如最近模型偏好），TTL 30–120 分钟；与 provider preset 可见性判定隔离。
  - `auth:ban:{user_id}`：封禁状态（类型、原因、过期时间）；临时封禁 TTL 设为剩余封禁时长，永久封禁可用特殊标记或极长 TTL。
- 清理策略：角色/权限变更、用户禁用/封禁、密码重置后，需清理 `auth:*` 与 `acl:perm:*` 相关键；提供按前缀清除的后台管理接口（复用 `cache.clear_prefix`）。

## API 契约草案（摘要）
| 接口 | 方法 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| /api/v1/auth/login | POST | 无 | 登录换取 access/refresh token |
| /api/v1/auth/refresh | POST | Refresh Token | 换取新 access token |
| /api/v1/auth/logout | POST | Access Token | 令牌失效，清理 Redis 记录 |
| /api/v1/users/register | POST | 无 / 邀请码（受控时） | 注册新用户，必要时校验邀请码并占用窗口 |
| /api/v1/users/activate | POST | 无 | 验证码激活账号 |
| /api/v1/users/reset-password | POST | 无 | 验证码重设密码 |
| /api/v1/users/me | GET | Access Token / X-User-Id | 当前用户信息 + 角色 + 权限 flags |
| /api/v1/users/me | PATCH | Access Token / X-User-Id | 更新个人展示信息 |
| /api/v1/users/me/change-password | POST | Access Token / X-User-Id | 变更密码并提升 token_version |
| /api/v1/admin/users | GET | 权限：`user.manage` | 分页查询用户 |
| /api/v1/admin/users | POST | 权限：`user.manage` | 创建用户（随机密码+邮件通知） |
| /api/v1/admin/users/{id} | PATCH | 权限：`user.manage` | 启用/禁用/重置密码 |
| /api/v1/admin/users/{id}/roles | POST | 权限：`role.manage` | 绑定/解绑角色 |
| /api/v1/admin/roles | GET | 权限：`role.view` | 列出角色及权限 |
| /api/v1/admin/permissions | GET | 权限：`role.view` | 列出权限字典 |
| /api/v1/admin/users/{id}/ban | POST | 权限：`user.manage` | 设置永久/临时封禁，写入 Redis 并失效 token |
| /api/v1/admin/users/{id}/unban | POST | 权限：`user.manage` | 解除封禁，清理封禁键并允许重新登录 |

## 后续落地清单
- 补充 Pydantic Schema（UserRead/UserCreate/LoginRequest/TokenPair 等）与路由骨架，放置于 `app/api/v1`、`app/schemas`、`app/services/users`。
- 扩展 `get_current_user` 支持 Authorization: Bearer，回退 `X-User-Id`，并将 token 解析/黑名单校验抽到独立模块。
- 在 `UserRepository` 增加按 email 查询、更新状态、角色绑定等接口；保持 async 版本，必要时提供 sync 版本给 Celery。
- 为 Redis 键操作提供轻量封装（如 AuthCache/PermissionCache），统一错误处理与 metrics。
- 编写对应单测：登录/刷新/失效、权限拒绝/放行、缓存命中/失效、登录限流/验证码、封禁/解封生效、MFA/密码策略、租户隔离、余额扣减并发；请人工运行 `pytest` 以验证。
- 设计错误码与统一响应体；更新 `docs/api/*` 与前端 i18n 文案 key 保持一致。
- 长连接踢下线与 token 续期策略（可用 pubsub + token_version）。
