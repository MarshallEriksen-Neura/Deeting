# 认证与注册控制（更新）

## 注册模式
- `REGISTRATION_CONTROL_ENABLED=True` 时，所有新用户必须携带邀请码；邮箱注册与 OAuth 首登共用同一准入策略。
- `REGISTRATION_CONTROL_ENABLED=False` 时开放注册，无需邀请码，仍支持 OAuth 自动绑定同邮箱用户。

## 邀请码与窗口
- 管理员通过 `/api/v1/admin/registration/windows` 创建注册窗口（设置开始/结束时间、名额、自动激活）。
- 通过 `/api/v1/admin/registration/windows/{id}/invites` 生成邀请码；消费时会占用对应窗口名额。

## OAuth（LinuxDo 示例）
- 授权入口 `/api/v1/auth/oauth/linuxdo/authorize` 支持 `invite_code` 参数，后端将其写入 state；回调后统一走用户落地管线。
- 若邮箱已存在则自动绑定 Identity；若为新用户且开启注册控制则需有效邀请码。

## 登录/注册行为
- 登录不再自动注册：不存在的邮箱登录返回 401。
- 注册接口 `/api/v1/users/register` 在开启注册控制时强制邀请码。

## 迁移与表
- `registration_windows`：控制注册窗口与名额。
- `invite_codes`：邀请码存储及窗口关联。

