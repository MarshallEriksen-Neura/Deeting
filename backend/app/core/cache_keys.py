"""缓存 Key 注册表实现。

禁止在业务代码中硬编码 Redis Key，统一从此处生成，便于失效管理。
"""

from __future__ import annotations


class CacheKeys:
    prefix = "gw"

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
        """上游熔断状态 key，按 host 维度存储"""
        return f"{cls.prefix}:cb:{upstream_host}"

    # ===== Bandit =====
    @classmethod
    def bandit_state(cls, preset_item_id: str) -> str:
        return f"{cls.prefix}:bandit:{preset_item_id}"

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
    def conversation_summary_job(cls, session_id: str) -> str:
        return f"{cls.prefix}:conv:{session_id}:summary_job"

    @classmethod
    def conversation_embedding_prefix(cls, session_id: str) -> str:
        return f"{cls.prefix}:conv:{session_id}:embed"

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
