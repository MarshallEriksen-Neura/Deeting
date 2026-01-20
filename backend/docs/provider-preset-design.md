# Provider Preset 重构设计（BYOP 通道模式）

## 目标
- 平台作为 AI 中间件/通道：用户自带算力与密钥（BYOP），我们提供标准接口、路由、日志、计费/审计。
- 配置分层：系统模板（协议知识）与用户实例（密钥与地址）解耦，模型列表作为实例的动态快照。

## 数据模型

### provider_preset（系统模板）
- 作用：定义如何与某厂商/协议交互（base_url 模板、auth_schema、默认 header/params、请求/响应映射、模型探测路径）。
- 关键字段：`slug`、`provider`、`base_url`、`auth_type`、`auth_config`、`default_headers`、`default_params`、`capability_configs`、`is_active`。
- 不存密钥、不存用户私有信息。

### provider_instance（用户实例 / 通道）
- 作用：用户绑定自己的 endpoint 与密钥。
- 主要字段：`user_id`(可空=公共实例)、`preset_slug`、`name`、`base_url`、`credentials_ref`、`priority`、`is_enabled`、`metadata`(探测/健康日志)。

### provider_model（模型快照，实例下）
- 作用：某实例可用的路由条目，直接驱动上游调用。
- 主要字段：`instance_id`、`capability`、`model_id`(上游真实标识)、`upstream_path`、`pricing_config`、`limit_config`、`tokenizer_config`、`routing_config`、`config_override`、`weight`、`priority`、`source`(auto/manual)、`extra_meta`、`synced_at`、`is_active`。
- 唯一约束：`(instance_id, capability, model_id, upstream_path)`。

### bandit_arm_state（多臂状态）
- 现在绑定 `provider_model_id`（非旧的 preset_item），用于路由决策反馈。

## 路由流程
1) API 读取用户上下文，传入 `capability + model`。
2) RoutingSelector：
   - 查可用 `provider_instance`（用户私有 + 公共）。
   - 查匹配的 `provider_model`（capability+model_id）。
   - 组合实例 base_url + model.upstream_path，合成 auth_config（模板 auth_config + instance.credentials_ref）。
   - 应用权重/优先级/灰度；Bandit 状态按 provider_model_id 评估。
3) Upstream 调用：使用模板/模型的 request/response 映射；计费与限流用模型的 pricing/limit 配置。
4) 反馈：Bandit 按 provider_model 记录成功率/延迟/成本。

## 管理与同步
- 创建实例：`POST /admin/provider-instances`（需要超管）。
- 同步/上报模型：`POST /admin/provider-instances/{id}/models:sync`（幂等 upsert，自动/手动探测皆可）。
- 查看实例模型：`GET /admin/provider-instances/{id}/models`。
- 迁移期不再使用 `provider_preset_item`；新路由完全依赖实例+模型快照。

## 权限与隔离
- 实例默认绑定创建者 `user_id`，仅本人可见；公共实例使用 `user_id IS NULL`。
- Admin 路由使用 `get_current_superuser`。
- 认证密钥仅存引用 `credentials_ref`，实际密钥通过 SecretManager 获取。

## 变更影响
- Bandit: FK 改为 provider_model_id；缓存 key 仍以 id 作为键。
- 计费: 计费记录关联 `provider_model_id`（routing.provider_model_id）。
- 文档与前端：前端的“添加渠道/同步模型”应使用新的 admin API；模型下拉来源为实例模型列表。

## 待补充
- 自动探测任务：根据 preset 的 fetch_models_path 调用实例并回写 provider_model。
- Bandit 报表前端展示需适配新的字段（instance_id/provider_model_id）。 
