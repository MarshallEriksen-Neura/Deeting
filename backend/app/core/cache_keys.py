"""缓存 Key 注册表实现。

禁止在业务代码中硬编码 Redis Key，统一从此处生成，便于失效管理。
"""

from __future__ import annotations


class CacheKeys:
    prefix = "gw"

    # ===== Provider Instance / Model =====
    @classmethod
    def provider_instance_list(cls, user_id: str | None, include_public: bool) -> str:
        """
        用户可见的 provider_instance 列表缓存 key。
        user_id 为 None 视作匿名；include_public 标记公共实例是否包含。
        """
        uid = user_id or "anonymous"
        scope = "withpub" if include_public else "private"
        return f"{cls.prefix}:pi:list:{uid}:{scope}"

    @classmethod
    def provider_model_list(cls, instance_id: str) -> str:
        """某实例下的 provider_model 列表缓存 key。"""
        return f"{cls.prefix}:pm:list:{instance_id}"

    @classmethod
    def provider_credentials(cls, instance_id: str) -> str:
        """某实例下的凭证列表缓存 key。"""
        return f"{cls.prefix}:pc:list:{instance_id}"

    @classmethod
    def provider_model_candidates(
        cls,
        capability: str,
        model_id: str,
        user_id: str | None,
        include_public: bool,
    ) -> str:
        """
        capability + model_id + 用户可见性的候选模型列表缓存 key。
        """
        uid = user_id or "anonymous"
        scope = "withpub" if include_public else "private"
        return f"{cls.prefix}:pm:cand:{capability}:{model_id}:{uid}:{scope}"

    # ===== Provider Preset =====
    @classmethod
    def provider_preset(cls, slug: str) -> str:
        """单个 ProviderPreset 缓存 key（按 slug）。"""
        return f"{cls.prefix}:preset:one:{slug}"

    @classmethod
    def provider_preset_active_list(cls) -> str:
        """活跃 ProviderPreset 列表缓存 key。"""
        return f"{cls.prefix}:preset:list:active"

    # ===== API Key =====
    @classmethod
    def api_key(cls, key_id: str) -> str:
        return f"{cls.prefix}:api_key:{key_id}"

    @classmethod
    def api_key_list(cls, tenant_id: str) -> str:
        return f"{cls.prefix}:api_key:list:{tenant_id}"

    @classmethod
    def api_key_revoked(cls, key_id: str) -> str:
        return f"{cls.prefix}:api_key:revoked:{key_id}"

    # ===== Provider Preset =====
    @classmethod
    def preset_routing(
        cls,
        capability: str,
        model: str,
        channel: str,
        providers: list[str] | None = None,
        presets: list[str] | None = None,
        preset_items: list[str] | None = None,
    ) -> str:
        """
        路由缓存 Key；当存在 provider/preset/item 过滤时附加摘要，避免跨权限复用。
        """
        base = f"{cls.prefix}:preset:{capability}:{model}:{channel}"
        if not (providers or presets or preset_items):
            return base

        import hashlib
        import json

        payload = {
            "pvd": sorted(providers or []),
            "pst": sorted(presets or []),
            "itm": sorted(preset_items or []),
        }
        digest = hashlib.md5(json.dumps(payload, separators=(",", ":")).encode()).hexdigest()[:10]
        return f"{base}:f:{digest}"

    @classmethod
    def preset_list(cls, channel: str) -> str:
        return f"{cls.prefix}:preset:list:{channel}"

    @classmethod
    def routing_table(cls, capability: str, channel: str) -> str:
        return f"{cls.prefix}:routing:{capability}:{channel}"

    @classmethod
    def upstream_template(cls, preset_item_id: str) -> str:
        """模板/上游路径渲染结果缓存 Key"""
        return f"{cls.prefix}:upstream_tpl:{preset_item_id}"

    # ===== Pricing & Quota =====
    @classmethod
    def pricing(cls, preset_id: str) -> str:
        return f"{cls.prefix}:pricing:{preset_id}"

    @classmethod
    def limit(cls, preset_id: str) -> str:
        return f"{cls.prefix}:limit:{preset_id}"

    # ===== Billing =====
    @classmethod
    def billing_deduct_idempotency(cls, tenant_id: str, trace_id: str) -> str:
        return f"{cls.prefix}:deduct:{tenant_id}:{trace_id}"

    @classmethod
    def quota_tenant(cls, tenant_id: str) -> str:
        return f"{cls.prefix}:quota:{tenant_id}"

    @classmethod
    def quota_api_key(cls, api_key_id: str) -> str:
        return f"{cls.prefix}:quota:ak:{api_key_id}"

    @classmethod
    def quota_hash(cls, tenant_id: str) -> str:
        """供 Lua 脚本使用的配额 Hash Key，避免与对象缓存冲突"""
        return f"{cls.prefix}:quota:{tenant_id}:hash"

    @classmethod
    def apikey_budget_hash(cls, api_key_id: str) -> str:
        """API Key 预算 Hash Key（供 Lua 脚本使用）"""
        return f"{cls.prefix}:quota:apikey:{api_key_id}"

    # ===== Credits =====
    @classmethod
    def credits_balance(cls, tenant_id: str) -> str:
        return f"{cls.prefix}:credits:balance:{tenant_id}"

    @classmethod
    def credits_consumption(cls, tenant_id: str, days: int) -> str:
        return f"{cls.prefix}:credits:consumption:{tenant_id}:{days}"

    @classmethod
    def credits_model_usage(cls, tenant_id: str, days: int) -> str:
        return f"{cls.prefix}:credits:model_usage:{tenant_id}:{days}"

    # ===== Request Cancel =====
    @classmethod
    def request_cancel(cls, capability: str, user_id: str, request_id: str) -> str:
        return f"{cls.prefix}:cancel:{capability}:{user_id}:{request_id}"

    # ===== Rate Limit =====
    @classmethod
    def rate_limit_rpm(cls, subject: str, route: str) -> str:
        return f"{cls.prefix}:rl:{subject}:{route}:rpm"

    @classmethod
    def rate_limit_tpm(cls, subject: str, route: str) -> str:
        return f"{cls.prefix}:rl:{subject}:{route}:tpm"

    @classmethod
    def rate_limit_global(cls, route: str) -> str:
        return f"{cls.prefix}:rl:global:{route}"

    # ===== Circuit Breaker =====
    @classmethod
    def circuit_breaker(cls, upstream_host: str) -> str:
        """上游熔断状态 key，按 host+credential 维度存储"""
        return f"{cls.prefix}:cb:{upstream_host}"

    # ===== Bandit =====
    @classmethod
    def bandit_state(cls, preset_item_id: str) -> str:
        return f"{cls.prefix}:bandit:{preset_item_id}"

    # ===== Routing Affinity (prefix-aware) =====
    @classmethod
    def routing_affinity(cls, prefix_fingerprint: str) -> str:
        """
        亲和路由缓存 Key：用于前缀感知的上游亲和（KV Cache 命中率优化）。
        prefix_fingerprint 已做哈希，避免泄露原文。
        """
        return f"{cls.prefix}:routing:affinity:{prefix_fingerprint}"

    @classmethod
    def routing_affinity_state(cls, session_id: str, model: str) -> str:
        """路由亲和状态机 Key（会话级别）"""
        return f"{cls.prefix}:routing:affinity:{session_id}:{model}"

    # ===== Tool Index =====
    @classmethod
    def tool_system_index_hash(cls) -> str:
        """系统工具索引的内容指纹缓存"""
        return f"{cls.prefix}:tool:index:system:hash"

    # ===== Security =====
    @classmethod
    def nonce(cls, tenant_id: str | None, nonce: str) -> str:
        tenant_part = tenant_id or "anonymous"
        return f"{cls.prefix}:nonce:{tenant_part}:{nonce}"

    @classmethod
    def signature_fail(cls, tenant_id: str | None) -> str:
        tenant_part = tenant_id or "anonymous"
        return f"{cls.prefix}:sig:fail:{tenant_part}"

    @classmethod
    def signature_fail_api_key(cls, api_key_id: str) -> str:
        return f"{cls.prefix}:sig:fail:ak:{api_key_id}"

    @classmethod
    def api_key_blacklist(cls, api_key_id: str) -> str:
        return f"{cls.prefix}:api_key:blacklist:{api_key_id}"

    # ===== Feature Rollout =====
    @classmethod
    def feature_rollout_enabled(cls, feature: str) -> str:
        return f"{cls.prefix}:feature:{feature}:enabled"

    @classmethod
    def feature_rollout_ratio(cls, feature: str) -> str:
        return f"{cls.prefix}:feature:{feature}:ratio"

    @classmethod
    def feature_rollout_allowlist(cls, feature: str) -> str:
        return f"{cls.prefix}:feature:{feature}:allowlist"

    # ===== Dashboard =====
    @classmethod
    def dashboard_stats(cls, tenant_id: str | None) -> str:
        return f"{cls.prefix}:dashboard:stats:{tenant_id or 'anonymous'}"

    @classmethod
    def dashboard_throughput(cls, tenant_id: str | None, period: str) -> str:
        return f"{cls.prefix}:dashboard:throughput:{tenant_id or 'anonymous'}:{period}"

    @classmethod
    def dashboard_smart_router(cls, tenant_id: str | None) -> str:
        return f"{cls.prefix}:dashboard:smart:{tenant_id or 'anonymous'}"

    @classmethod
    def dashboard_errors(cls, tenant_id: str | None, limit: int) -> str:
        return f"{cls.prefix}:dashboard:errors:{tenant_id or 'anonymous'}:{limit}"

    # ===== Monitoring =====
    @classmethod
    def monitoring_latency_heatmap(cls, tenant_id: str | None, time_range: str, model: str | None) -> str:
        return f"{cls.prefix}:mon:heatmap:{tenant_id or 'anonymous'}:{time_range}:{model or 'all'}"

    @classmethod
    def monitoring_percentile(cls, tenant_id: str | None, time_range: str) -> str:
        return f"{cls.prefix}:mon:percentile:{tenant_id or 'anonymous'}:{time_range}"

    @classmethod
    def monitoring_model_cost(cls, tenant_id: str | None, time_range: str) -> str:
        return f"{cls.prefix}:mon:model_cost:{tenant_id or 'anonymous'}:{time_range}"

    @classmethod
    def monitoring_error_distribution(cls, tenant_id: str | None, time_range: str, model: str | None) -> str:
        return f"{cls.prefix}:mon:err_dist:{tenant_id or 'anonymous'}:{time_range}:{model or 'all'}"

    @classmethod
    def monitoring_key_ranking(cls, tenant_id: str | None, time_range: str, limit: int) -> str:
        return f"{cls.prefix}:mon:key_rank:{tenant_id or 'anonymous'}:{time_range}:{limit}"

    # ===== Auth & ACL =====
    @classmethod
    def permission_codes(cls, user_id: str) -> str:
        return f"{cls.prefix}:acl:perm:{user_id}"

    @classmethod
    def token_blacklist(cls, jti: str) -> str:
        return f"{cls.prefix}:auth:access:{jti}"

    @classmethod
    def login_fail_email(cls, email: str) -> str:
        return f"{cls.prefix}:auth:login_fail:{email}"

    @classmethod
    def login_fail_ip(cls, ip: str) -> str:
        return f"{cls.prefix}:auth:login_fail_ip:{ip}"

    @classmethod
    def verify_code(cls, email: str, purpose: str) -> str:
        return f"{cls.prefix}:auth:verify:{email}:{purpose}"

    @classmethod
    def verify_attempts_email(cls, email: str, purpose: str) -> str:
        return f"{cls.prefix}:auth:verify_attempts:{email}:{purpose}"

    @classmethod
    def verify_attempts_ip(cls, ip: str | None, purpose: str) -> str:
        return f"{cls.prefix}:auth:verify_attempts_ip:{ip}:{purpose}"

    @classmethod
    def oauth_linuxdo_state(cls, state: str) -> str:
        return f"{cls.prefix}:auth:oauth:linuxdo:state:{state}"

    # ===== Usage (placeholder) =====
    @classmethod
    def usage_records(cls) -> str:
        return f"{cls.prefix}:usage:records"

    @classmethod
    def tenant_ban(cls, tenant_id: str) -> str:
        return f"{cls.prefix}:tenant:ban:{tenant_id}"

    @classmethod
    def user_ban(cls, user_id: str) -> str:
        return f"{cls.prefix}:user:ban:{user_id}"

    # ===== Secrets =====
    @classmethod
    def upstream_credential(cls, provider: str, secret_ref_id: str | None = None) -> str:
        base = f"{cls.prefix}:upstream_cred:{provider}"
        return f"{base}:{secret_ref_id}" if secret_ref_id else base

    # ===== Conversation Context =====
    @classmethod
    def conversation_meta(cls, session_id: str) -> str:
        return f"{cls.prefix}:conv:{session_id}:meta"

    @classmethod
    def conversation_messages(cls, session_id: str) -> str:
        return f"{cls.prefix}:conv:{session_id}:msgs"

    @classmethod
    def conversation_summary(cls, session_id: str) -> str:
        return f"{cls.prefix}:conv:{session_id}:summary"

    @classmethod
    def conversation_lock(cls, session_id: str) -> str:
        return f"{cls.prefix}:conv:{session_id}:lock"

    @classmethod
    def session_lock(cls, session_id: str) -> str:
        """会话分布式锁 Key"""
        return f"{cls.prefix}:session:{session_id}:lock"

    @classmethod
    def conversation_summary_job(cls, session_id: str) -> str:
        return f"{cls.prefix}:conv:{session_id}:summary_job"

    @classmethod
    def conversation_summary_last_active(cls, session_id: str) -> str:
        return f"{cls.prefix}:conv:{session_id}:summary:last_active"

    @classmethod
    def conversation_summary_pending_task(cls, session_id: str) -> str:
        return f"{cls.prefix}:conv:{session_id}:summary:pending"

    @classmethod
    def conversation_embedding_prefix(cls, session_id: str) -> str:
        return f"{cls.prefix}:conv:{session_id}:embed"

    # ===== Auth / Invite =====
    @classmethod
    def temp_invite(cls, email: str) -> str:
        """登录前暂存的邀请码占用记录。"""
        return f"{cls.prefix}:auth:invite:{email}"

    # ===== Memory Scheduler =====
    @classmethod
    def memory_last_active(cls, session_id: str) -> str:
        return f"{cls.prefix}:memory:{session_id}:last_active"

    @classmethod
    def memory_pending_task(cls, session_id: str) -> str:
        return f"{cls.prefix}:memory:{session_id}:pending"

    # ===== Config Version =====
    @classmethod
    def cfg_version(cls) -> str:
        return f"{cls.prefix}:cfg:version"

    @classmethod
    def cfg_updated_at(cls) -> str:
        return f"{cls.prefix}:cfg:updated_at"

    # ===== System Settings =====
    @classmethod
    def system_embedding_model(cls) -> str:
        return f"{cls.prefix}:settings:embedding:model"
