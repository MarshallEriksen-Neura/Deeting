"""
API Key Service

职责:
- 封装 API Key 业务逻辑
- Key 生成与哈希计算
- 校验与鉴权
- 限流与配额检查
- 缓存管理

方法清单:
- generate_key(type, name, ...) -> (ApiKey, raw_key)
- validate_key(raw_key) -> ApiPrincipal | None
- verify_signature(key, timestamp, nonce, signature, body_hash) -> bool
- check_rate_limit(api_key_id, endpoint) -> RateLimitResult
- check_quota(api_key_id, quota_type, amount) -> QuotaCheckResult
- deduct_quota(api_key_id, quota_type, amount) -> bool
- check_scope(api_key_id, scope_type, scope_value) -> bool
- check_ip(api_key_id, client_ip) -> bool
- rotate_key(api_key_id) -> (ApiKey, raw_key)
- revoke_key(api_key_id, reason) -> ApiKey
- get_key_info(api_key_id) -> ApiKeyInfo
- list_keys(tenant_id?, user_id?, status?) -> list[ApiKey]
- update_key(api_key_id, data) -> ApiKey
- delete_key(api_key_id) -> bool

缓存策略:
- Redis 缓存 Key 元数据 (TTL 5min)
- 变更时主动失效缓存
- 支持缓存穿透保护

使用示例:
    from app.services.providers.api_key import ApiKeyService

    service = ApiKeyService(repo, redis)

    # 生成 Key
    key, raw_key = await service.generate_key(
        type=ApiKeyType.EXTERNAL,
        name="Production Key",
        tenant_id=tenant_uuid,
    )

    # 校验 Key
    principal = await service.validate_key(request_key)
    if not principal:
        raise HTTPException(401, "Invalid API Key")
"""
import hashlib
import hmac
import secrets
import string
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.models.api_key import (
    ApiKey,
    ApiKeyStatus,
    ApiKeyType,
    QuotaType,
    ScopeType,
)
from app.repositories.api_key import ApiKeyRepository
from app.utils.time_utils import Datetime

# ============================================================
# 数据传输对象
# ============================================================

@dataclass
class ApiPrincipal:
    """
    API 调用主体

    校验通过后注入上下文，供后续限流/计费/审计使用
    """
    api_key_id: UUID
    key_type: ApiKeyType
    tenant_id: UUID | None
    user_id: UUID | None
    scopes: list[str]           # 允许的 scope 列表
    is_whitelist: bool          # 是否限流白名单
    rate_limit_rpm: int | None
    rate_limit_tpm: int | None
    allowed_models: list[str] | None = None
    allowed_ips: list[str] | None = None
    budget_limit: float | None = None
    budget_used: float = 0
    enable_logging: bool = True
    secret_hash: str | None = None   # 独立签名密钥的哈希（不含明文）
    secret_hint: str | None = None   # 末四位提示，便于审计/运维


@dataclass
class RateLimitResult:
    """限流检查结果"""
    allowed: bool
    remaining: int              # 剩余请求数
    reset_at: datetime          # 重置时间
    limit: int                  # 限制值
    retry_after: int | None  # 需等待秒数（被限流时）


@dataclass
class QuotaCheckResult:
    """配额检查结果"""
    allowed: bool
    remaining: int              # 剩余配额
    total: int                  # 总配额
    reset_at: datetime | None  # 下次重置时间

class ApiKeyServiceError(Exception):
    """Base exception for API Key service"""
    pass


# ============================================================
# Service 实现
# ============================================================

class ApiKeyService:
    """
    API Key 业务服务

    安全设计:
    - 使用 HMAC-SHA256 哈希存储
    - 支持 HMAC 签名校验
    - Nonce 去重防重放
    """

    # Key 前缀
    PREFIX_INTERNAL = "sk-int-"
    PREFIX_EXTERNAL = "sk-ext-"

    # Key 长度（Base62 编码后）
    KEY_LENGTH = 48

    # 签名时间窗口（秒）
    SIGNATURE_TIME_WINDOW = 300  # ±5 分钟

    # Nonce TTL（秒）
    NONCE_TTL = 600  # 10 分钟

    def __init__(
        self,
        repository: ApiKeyRepository,
        redis_client,  # aioredis.Redis
        secret_key: str,
    ):
        self.repository = repository
        self.redis = redis_client
        self.secret_key = secret_key

    # ============================================================
    # Key 生成
    # ============================================================

    async def generate_key(
        self,
        key_type: ApiKeyType,
        name: str,
        created_by: UUID,
        tenant_id: UUID | None = None,
        user_id: UUID | None = None,
        expires_at: datetime | None = None,
        scopes: list[dict] | None = None,
        rate_limit: dict | None = None,
        quotas: list[dict] | None = None,
        ip_whitelist: list[str] | None = None,
        generate_secret: bool = True,
        allowed_models: list[str] | None = None,
        allowed_ips: list[str] | None = None,
        budget_limit: float | None = None,
        rate_limit_rpm: int | None = None,
        enable_logging: bool | None = None,
    ) -> tuple[ApiKey, str, str | None]:
        """
        生成新的 API Key

        Args:
            generate_secret: 是否同时生成签名专用 Secret（默认 True）

        Returns:
            (ApiKey, raw_key, raw_secret): 模型对象、原始 Key 和原始 Secret（仅此一次可见）
        """
        raw_key = self._generate_raw_key(key_type)
        key_hash = self._compute_key_hash(raw_key)

        # 生成独立的签名密钥
        raw_secret = None
        secret_hash = None
        secret_hint = None
        if generate_secret:
            raw_secret = self._generate_raw_secret()
            secret_hash = self._compute_key_hash(raw_secret)
            secret_hint = raw_secret[-4:]

        data = {
            "key_prefix": raw_key[:7],
            "key_hash": key_hash,
            "key_hint": raw_key[-4:],
            "secret_hash": secret_hash,
            "secret_hint": secret_hint,
            "type": key_type,
            "status": ApiKeyStatus.ACTIVE,
            "name": name,
            "description": None,
            "tenant_id": tenant_id,
            "user_id": user_id,
            "created_by": created_by,
            "expires_at": expires_at,
            "allowed_models": allowed_models or [],
            "allowed_ips": allowed_ips or ip_whitelist or [],
            "budget_limit": budget_limit,
            "budget_used": 0,
            "rate_limit_rpm": rate_limit_rpm or (rate_limit or {}).get("rpm"),
            "enable_logging": True if enable_logging is None else enable_logging,
        }

        key_obj = await self.repository.create(data)

        # scopes
        if scopes:
            for s in scopes:
                await self.repository.add_scope(
                    api_key_id=key_obj.id,
                    scope_type=s.get("type", ScopeType.CAPABILITY),
                    scope_value=s.get("value", ""),
                    permission=s.get("permission", "allow"),
                )

        # rate limit
        if rate_limit:
            await self.repository.update_rate_limit(key_obj.id, rate_limit)

        # quotas
        if quotas:
            for q in quotas:
                await self.repository.add_quota(
                    api_key_id=key_obj.id,
                    quota_type=q.get("type", QuotaType.REQUEST),
                    total_quota=q.get("total", 0),
                    reset_period=q.get("reset_period", "monthly"),
                )

        # ip whitelist
        if ip_whitelist:
            for ip in ip_whitelist:
                await self.repository.add_ip_whitelist(key_obj.id, ip)

        await self.repository.session.commit()
        return key_obj, raw_key, raw_secret

    def _generate_raw_key(self, key_type: ApiKeyType) -> str:
        """生成原始 Key（前缀 + Base62 随机字符串）"""
        prefix = self.PREFIX_EXTERNAL if key_type == ApiKeyType.EXTERNAL else self.PREFIX_INTERNAL
        alphabet = string.ascii_letters + string.digits
        random_part = ''.join(secrets.choice(alphabet) for _ in range(self.KEY_LENGTH))
        return f"{prefix}{random_part}"

    def _generate_raw_secret(self) -> str:
        """生成原始 Secret（纯 Base62 随机字符串，用于 HMAC 签名）"""
        alphabet = string.ascii_letters + string.digits
        return ''.join(secrets.choice(alphabet) for _ in range(self.KEY_LENGTH))

    def _compute_key_hash(self, raw_key: str) -> str:
        """计算 Key 的 HMAC-SHA256 哈希"""
        return hmac.new(
            self.secret_key.encode(),
            raw_key.encode(),
            hashlib.sha256
        ).hexdigest()

    # ============================================================
    # Key 校验
    # ============================================================

    async def validate_key(self, raw_key: str) -> ApiPrincipal | None:
        """
        校验 API Key

        步骤:
        1. 计算哈希
        2. 查询缓存/数据库
        3. 校验状态和过期时间
        4. 构造 ApiPrincipal

        Returns:
            ApiPrincipal 或 None（校验失败）
        """
        if not raw_key:
            return None

        key_hash = self._compute_key_hash(raw_key)

        # 缓存检查
        cache_key = CacheKeys.api_key(key_hash)
        cached = await cache.get(cache_key)
        if cached:
            return cached

        obj = await self.repository.get_by_key_hash(key_hash)
        if not obj or obj.status != ApiKeyStatus.ACTIVE:
            return None
        if obj.expires_at and obj.expires_at < Datetime.utcnow():
            return None

        scopes = [f"{s.scope_type}:{s.scope_value}" for s in obj.scopes]
        rl = obj.rate_limit
        principal = ApiPrincipal(
            api_key_id=obj.id,
            key_type=obj.type,
            tenant_id=obj.tenant_id,
            user_id=obj.user_id,
            scopes=scopes,
            is_whitelist=bool(rl.is_whitelist) if rl else False,
            rate_limit_rpm=getattr(obj, "rate_limit_rpm", None) or (rl.rpm if rl else None),
            rate_limit_tpm=rl.tpm if rl else None,
            allowed_models=getattr(obj, "allowed_models", None),
            allowed_ips=getattr(obj, "allowed_ips", None),
            budget_limit=float(obj.budget_limit) if getattr(obj, "budget_limit", None) is not None else None,
            budget_used=float(obj.budget_used) if getattr(obj, "budget_used", None) is not None else 0,
            enable_logging=bool(getattr(obj, "enable_logging", True)),
            secret_hash=obj.secret_hash,
            secret_hint=obj.secret_hint,
        )

        await self.repository.update_last_used(obj.id)
        await self.repository.session.commit()
        await cache.set(cache_key, principal, ttl=300)
        return principal

    async def verify_signature(
        self,
        raw_key: str,
        timestamp: int,
        nonce: str,
        signature: str,
        body_hash: str,
        raw_secret: str | None = None,
    ) -> bool:
        """
        校验 HMAC 签名（外部请求）

        签名格式: HMAC-SHA256(secret, "{timestamp}.{nonce}.{body_hash}")

        参数:
            raw_key: API Key 原始值（用于身份识别）
            raw_secret: Secret 原始值（用于签名验证，若为 None 则回退到 raw_key）
            timestamp: 请求时间戳
            nonce: 唯一随机数
            signature: 客户端计算的签名
            body_hash: 请求体哈希

        步骤:
        1. 验证时间戳在窗口内
        2. 检查 nonce 去重
        3. 重算签名比对（优先使用 secret，回退 key）
        """
        import time

        # 1. 时间戳窗口校验
        now = int(time.time())
        if abs(now - timestamp) > self.SIGNATURE_TIME_WINDOW:
            return False

        # 2. Nonce 去重（需要先校验 Key 获取 api_key_id）
        key_hash = self._compute_key_hash(raw_key)
        api_key = await self.repository.get_by_key_hash(key_hash)
        if not api_key:
            return False

        nonce_used = await self._check_nonce(api_key.id, nonce)
        if nonce_used:
            return False

        # 3. 确定签名密钥
        # 优先使用提供的 raw_secret，否则检查是否有存储的 secret_hash
        # 如果都没有，回退到使用 raw_key（向后兼容）
        signing_key = raw_secret
        if not signing_key:
            # 如果 API Key 有独立 secret，客户端应该提供 raw_secret
            # 这里回退到 raw_key 是为了向后兼容
            signing_key = raw_key

        # 4. 重算签名比对
        message = f"{timestamp}.{nonce}.{body_hash}"
        expected_signature = hmac.new(
            signing_key.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()

        return hmac.compare_digest(signature, expected_signature)

    async def verify_signature_by_secret_hash(
        self,
        api_key_id: UUID,
        timestamp: int,
        nonce: str,
        signature: str,
        body_hash: str,
        raw_secret: str,
    ) -> bool:
        """
        使用 secret_hash 校验签名（更安全的方式）

        此方法不需要客户端传递 raw_key，只需 api_key_id 和 raw_secret

        步骤:
        1. 验证 API Key 存在且有 secret_hash
        2. 验证提供的 raw_secret 的哈希与存储的 secret_hash 匹配
        3. 验证时间戳窗口
        4. 检查 nonce 去重
        5. 验证签名
        """
        import time

        # 1. 获取 API Key
        api_key = await self.repository.get_by_id(api_key_id)
        if not api_key or not api_key.secret_hash:
            return False

        # 2. 验证 secret_hash 匹配
        provided_secret_hash = self._compute_key_hash(raw_secret)
        if not hmac.compare_digest(provided_secret_hash, api_key.secret_hash):
            return False

        # 3. 时间戳窗口校验
        now = int(time.time())
        if abs(now - timestamp) > self.SIGNATURE_TIME_WINDOW:
            return False

        # 4. Nonce 去重
        nonce_used = await self._check_nonce(api_key_id, nonce)
        if nonce_used:
            return False

        # 5. 重算签名比对
        message = f"{timestamp}.{nonce}.{body_hash}"
        expected_signature = hmac.new(
            raw_secret.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()

        return hmac.compare_digest(signature, expected_signature)

    async def _check_nonce(self, api_key_id: UUID, nonce: str) -> bool:
        """检查 nonce 是否已使用（Redis SETNX）"""
        if not self.redis:
            # 无 Redis 时跳过 nonce 检查
            return False

        key = f"gw:nonce:{api_key_id}:{nonce}"
        # SETNX: 如果 key 不存在则设置并返回 True，存在则返回 False
        result = await self.redis.set(key, "1", nx=True, ex=self.NONCE_TTL)
        # 如果 result 为 None 或 False，说明 key 已存在（nonce 已使用）
        return result is None or result is False

    # ============================================================
    # 限流与配额
    # ============================================================

    async def check_rate_limit(
        self,
        api_key_id: UUID,
        endpoint: str,
    ) -> RateLimitResult:
        """
        检查限流

        使用 Key 级别 + 全局级别叠加取最严格值
        """
        rl = await self.repository.get_rate_limit(api_key_id)
        if not rl or rl.is_whitelist:
            # 白名单或无配置，不限流
            return RateLimitResult(
                allowed=True,
                remaining=-1,
                reset_at=Datetime.utcnow() + timedelta(minutes=1),
                limit=-1,
                retry_after=None,
            )

        # TODO: 接入 Redis 滑动窗口限流
        # 当前简化实现：直接放行
        limit = rl.rpm or 1000
        return RateLimitResult(
            allowed=True,
            remaining=limit,
            reset_at=Datetime.utcnow() + timedelta(minutes=1),
            limit=limit,
            retry_after=None,
        )

    async def check_quota(
        self,
        api_key_id: UUID,
        quota_type: QuotaType,
        amount: int,
    ) -> QuotaCheckResult:
        """
        检查配额（预检，不扣减）
        """
        quota = await self.repository.get_quota(api_key_id, quota_type)
        if not quota:
            # 无配额限制
            return QuotaCheckResult(
                allowed=True,
                remaining=-1,
                total=-1,
                reset_at=None,
            )

        remaining = quota.total_quota - quota.used_quota
        allowed = remaining >= amount

        return QuotaCheckResult(
            allowed=allowed,
            remaining=remaining,
            total=quota.total_quota,
            reset_at=quota.reset_at,
        )

    async def deduct_quota(
        self,
        api_key_id: UUID,
        quota_type: QuotaType,
        amount: int,
    ) -> bool:
        """
        扣减配额

        Returns:
            True = 扣减成功，False = 配额不足
        """
        check = await self.check_quota(api_key_id, quota_type, amount)
        if not check.allowed:
            return False

        await self.repository.update_quota_usage(api_key_id, quota_type, amount)
        await self.repository.session.commit()
        return True

    # ============================================================
    # 权限检查
    # ============================================================

    async def check_scope(
        self,
        api_key_id: UUID,
        scope_type: ScopeType,
        scope_value: str,
    ) -> bool:
        """
        检查权限范围

        处理逻辑:
        1. 如果有 deny 规则匹配 -> False
        2. 如果有 allow 规则匹配 -> True
        3. 如果无规则 -> 默认行为（external=False, internal=True）
        """
        api_key = await self.repository.get_by_id(api_key_id)
        if not api_key:
            return False

        scopes = api_key.scopes
        if not scopes:
            # 无规则时，内部 Key 默认允许，外部 Key 默认拒绝
            return api_key.type == ApiKeyType.INTERNAL

        # 检查 deny 规则
        for scope in scopes:
            if scope.scope_type == scope_type and scope.scope_value == scope_value:
                if scope.permission == "deny":
                    return False

        # 检查 allow 规则
        for scope in scopes:
            if scope.scope_type == scope_type and scope.scope_value == scope_value:
                if scope.permission == "allow":
                    return True

        # 无匹配规则，使用默认行为
        return api_key.type == ApiKeyType.INTERNAL

    async def check_ip(
        self,
        api_key_id: UUID,
        client_ip: str | None,
        client_host: str | None = None,
    ) -> bool:
        """
        检查 IP / 域名白名单

        规则：
        - 如果未配置白名单，直接允许
        - 若配置了白名单且无法获取 IP/Host，则拒绝（外部通道必须提供）
        - 支持:
            * 单个 IP: 1.2.3.4
            * CIDR: 192.168.0.0/24
            * 域名: example.com
            * 通配域名: *.example.com
        """
        import ipaddress

        whitelist = await self.repository.get_ip_whitelist(api_key_id)
        if not whitelist:
            # 无白名单配置，允许所有
            return True

        if not client_ip and not client_host:
            return False

        client_host_norm = client_host.lower() if client_host else None
        client_addr = None
        if client_ip:
            try:
                client_addr = ipaddress.ip_address(client_ip)
            except ValueError:
                client_addr = None

        def _match_domain(pattern: str, host: str) -> bool:
            pattern = pattern.lower()
            host = host.lower()
            if pattern.startswith("*."):
                return host.endswith(pattern[1:]) or host == pattern[2:]
            return host == pattern

        for entry in whitelist:
            raw = entry.ip_pattern.strip()
            if not raw:
                continue
            # 尝试 IP/CIDR
            try:
                if "/" in raw:
                    network = ipaddress.ip_network(raw, strict=False)
                    if client_addr and client_addr in network:
                        return True
                    continue
                addr = ipaddress.ip_address(raw)
                if client_addr and client_addr == addr:
                    return True
                continue
            except ValueError:
                # 不是合法 IP，按域名处理
                if client_host_norm and _match_domain(raw, client_host_norm):
                    return True
                continue

        return False

    # ============================================================
    # Key 管理
    # ============================================================

    async def rotate_key(
        self,
        api_key_id: UUID,
        grace_period_hours: int = 24,
    ) -> tuple[ApiKey, str, str | None]:
        """
        轮换 Key

        步骤:
        1. 将旧 Key 状态设为 expiring
        2. 设置旧 Key 过期时间 = now + grace_period
        3. 生成新 Key（继承旧 Key 配置）
        4. 返回新 Key

        Returns:
            (new_key, raw_key, raw_secret)
        """
        old_key = await self.repository.get_by_id(api_key_id)
        if not old_key:
            return None, None, None

        # 1. 更新旧 Key 状态
        old_expires_at = Datetime.utcnow() + timedelta(hours=grace_period_hours)
        await self.repository.update(api_key_id, {
            "status": ApiKeyStatus.EXPIRING,
            "expires_at": old_expires_at,
        })

        # 2. 生成新 Key（继承旧 Key 配置）
        new_key, raw_key, raw_secret = await self.generate_key(
            key_type=old_key.type,
            name=f"{old_key.name} (rotated)",
            created_by=old_key.created_by,
            tenant_id=old_key.tenant_id,
            user_id=old_key.user_id,
            expires_at=old_key.expires_at,  # 继承原过期时间
            allowed_models=getattr(old_key, "allowed_models", None),
            allowed_ips=getattr(old_key, "allowed_ips", None),
            budget_limit=getattr(old_key, "budget_limit", None),
            rate_limit_rpm=getattr(old_key, "rate_limit_rpm", None),
            enable_logging=getattr(old_key, "enable_logging", None),
        )

        # 3. 复制 scopes
        for scope in old_key.scopes:
            await self.repository.add_scope(
                api_key_id=new_key.id,
                scope_type=scope.scope_type,
                scope_value=scope.scope_value,
                permission=scope.permission,
            )

        # 4. 复制 rate limit
        if old_key.rate_limit:
            rl = old_key.rate_limit
            await self.repository.update_rate_limit(new_key.id, {
                "rpm": rl.rpm,
                "tpm": rl.tpm,
                "rpd": rl.rpd,
                "tpd": rl.tpd,
                "concurrent_limit": rl.concurrent_limit,
                "burst_limit": rl.burst_limit,
                "is_whitelist": rl.is_whitelist,
            })

        # 5. 复制 IP 白名单
        for ip_entry in old_key.ip_whitelist:
            await self.repository.add_ip_whitelist(
                new_key.id, ip_entry.ip_pattern, ip_entry.description
            )

        await self.repository.session.commit()

        # 6. 失效旧 Key 缓存
        await self._invalidate_cache(old_key.key_hash)

        return new_key, raw_key, raw_secret

    async def regenerate_secret(
        self,
        api_key_id: UUID,
    ) -> tuple[ApiKey | None, str | None]:
        """
        重新生成签名专用 Secret（不影响 API Key 本身）

        用途:
        - Secret 泄露时独立轮换
        - 已有 Key 补充生成 Secret

        Returns:
            (ApiKey, raw_secret): 更新后的模型对象和新的原始 Secret
        """
        api_key = await self.repository.get_by_id(api_key_id)
        if not api_key:
            return None, None

        # 生成新 Secret
        raw_secret = self._generate_raw_secret()
        secret_hash = self._compute_key_hash(raw_secret)
        secret_hint = raw_secret[-4:]

        # 更新数据库
        await self.repository.update(api_key_id, {
            "secret_hash": secret_hash,
            "secret_hint": secret_hint,
        })
        await self.repository.session.commit()

        # 失效缓存
        await self._invalidate_cache(api_key.key_hash)

        # 返回更新后的对象
        updated_key = await self.repository.get_by_id(api_key_id)
        return updated_key, raw_secret

    async def revoke_key(
        self,
        api_key_id: UUID,
        reason: str,
    ) -> ApiKey | None:
        """
        吊销 Key

        立即生效，同时清除缓存
        """
        api_key = await self.repository.get_by_id(api_key_id)
        if not api_key:
            return None

        # 更新状态
        await self.repository.update(api_key_id, {
            "status": ApiKeyStatus.REVOKED,
            "revoked_at": Datetime.utcnow(),
            "revoked_reason": reason,
        })
        await self.repository.session.commit()

        # 失效缓存
        await self._invalidate_cache(api_key.key_hash)

        # 重新获取更新后的对象
        return await self.repository.get_by_id(api_key_id)

    async def get_key_info(self, api_key_id: UUID) -> ApiKey | None:
        """获取 Key 详情"""
        return await self.repository.get_by_id(api_key_id)

    async def list_keys(
        self,
        tenant_id: UUID | None = None,
        user_id: UUID | None = None,
        status: ApiKeyStatus | None = None,
    ) -> list[ApiKey]:
        """列出 Key"""
        return await self.repository.list_keys(
            tenant_id=tenant_id,
            user_id=user_id,
            status=status,
        )

    async def update_key(
        self,
        api_key_id: UUID,
        data: dict,
    ) -> ApiKey | None:
        """
        更新 Key 配置

        可更新: name, expires_at, scopes, rate_limit, quotas, ip_whitelist
        """
        api_key = await self.repository.get_by_id(api_key_id)
        if not api_key:
            return None

        # 更新基本字段
        update_fields = {}
        for field in ["name", "description", "expires_at"]:
            if field in data:
                update_fields[field] = data[field]

        if update_fields:
            await self.repository.update(api_key_id, update_fields)

        await self.repository.session.commit()

        # 失效缓存
        await self._invalidate_cache(api_key.key_hash)

        return await self.repository.get_by_id(api_key_id)

    async def delete_key(self, api_key_id: UUID) -> bool:
        """删除 Key"""
        api_key = await self.repository.get_by_id(api_key_id)
        if not api_key:
            return False

        key_hash = api_key.key_hash
        success = await self.repository.delete(api_key_id)
        await self.repository.session.commit()

        if success:
            await self._invalidate_cache(key_hash)

        return success

    # ============================================================
    # 缓存管理
    # ============================================================

    async def _get_from_cache(self, key_hash: str) -> dict | None:
        """从 Redis 缓存获取 Key 元数据"""
        if not self.redis:
            return None

        cache_key = CacheKeys.api_key(key_hash)
        try:
            import json
            data = await self.redis.get(cache_key)
            if data:
                return json.loads(data)
        except Exception:
            pass
        return None

    async def _set_cache(self, key_hash: str, data: dict, ttl: int = 300) -> None:
        """设置 Redis 缓存"""
        if not self.redis:
            return

        cache_key = CacheKeys.api_key(key_hash)
        try:
            import json
            await self.redis.set(cache_key, json.dumps(data), ex=ttl)
        except Exception:
            pass

    async def _invalidate_cache(self, key_hash: str) -> None:
        """失效 Redis 缓存"""
        if not self.redis:
            return

        cache_key = CacheKeys.api_key(key_hash)
        try:
            await self.redis.delete(cache_key)
        except Exception:
            pass

        # 同时失效通用缓存
        try:
            await cache.delete(cache_key)
        except Exception:
            pass

    # ============================================================
    # 批量操作
    # ============================================================

    async def revoke_tenant_keys(
        self,
        tenant_id: UUID,
        reason: str,
    ) -> int:
        """
        批量吊销租户所有 Key（封禁联动）

        Returns:
            吊销的 Key 数量
        """
        # 获取租户所有活跃 Key
        keys = await self.repository.list_keys(
            tenant_id=tenant_id,
            status=ApiKeyStatus.ACTIVE,
        )

        count = 0
        for key in keys:
            await self.repository.update(key.id, {
                "status": ApiKeyStatus.REVOKED,
                "revoked_at": Datetime.utcnow(),
                "revoked_reason": reason,
            })
            await self._invalidate_cache(key.key_hash)
            count += 1

        await self.repository.session.commit()
        return count

    async def revoke_user_keys(
        self,
        user_id: UUID,
        reason: str,
    ) -> int:
        """批量吊销用户所有 Key"""
        # 获取用户所有活跃 Key
        keys = await self.repository.list_keys(
            user_id=user_id,
            status=ApiKeyStatus.ACTIVE,
        )

        count = 0
        for key in keys:
            await self.repository.update(key.id, {
                "status": ApiKeyStatus.REVOKED,
                "revoked_at": Datetime.utcnow(),
                "revoked_reason": reason,
            })
            await self._invalidate_cache(key.key_hash)
            count += 1

        await self.repository.session.commit()
        return count
