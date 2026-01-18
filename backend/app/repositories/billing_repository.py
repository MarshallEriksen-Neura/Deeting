"""
BillingRepository: 计费流水管理

提供基于 BillingTransaction 表的计费管理：
- 扣费流水记录（幂等防重、两阶段提交）
- 余额查询与扣减（与 QuotaRepository 联动）
- 冲正处理
"""

from __future__ import annotations

import uuid
import asyncio
from datetime import datetime
from decimal import Decimal

from sqlalchemy import and_, event, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.core.logging import logger
from app.models.billing import BillingTransaction, TenantQuota, TransactionStatus, TransactionType
from app.repositories.quota_repository import InsufficientQuotaError, QuotaRepository


class InsufficientBalanceError(Exception):
    """余额不足异常"""

    def __init__(self, required: Decimal, available: Decimal):
        self.required = required
        self.available = available
        super().__init__(f"Insufficient balance: required={required}, available={available}")


class DuplicateTransactionError(Exception):
    """重复交易异常（幂等键已存在）"""

    def __init__(self, trace_id: str):
        self.trace_id = trace_id
        super().__init__(f"Duplicate transaction: trace_id={trace_id}")


class BillingRepository:
    """计费管理 Repository"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self._quota_repo = QuotaRepository(session)

    async def create_pending_transaction(
        self,
        tenant_id: str | uuid.UUID,
        trace_id: str,
        estimated_tokens: int = 0,
        pricing: dict | None = None,
        api_key_id: str | uuid.UUID | None = None,
        provider: str | None = None,
        model: str | None = None,
        preset_item_id: str | uuid.UUID | None = None,
    ) -> BillingTransaction:
        """
        创建 PENDING 交易（流式请求预扣，不扣余额）

        - 幂等：trace_id 已存在直接返回
        - 估算费用仅用于预检查与审计，不扣减
        """
        if isinstance(tenant_id, str):
            tenant_id = uuid.UUID(tenant_id)
        if isinstance(preset_item_id, str):
            preset_item_id = uuid.UUID(preset_item_id)
        if isinstance(api_key_id, str):
            api_key_id = uuid.UUID(api_key_id)

        existing = await self.get_by_trace_id(trace_id)
        if existing:
            return existing

        estimated_cost = Decimal("0")
        if pricing and estimated_tokens > 0:
            input_per_1k = Decimal(str(pricing.get("input_per_1k", 0)))
            estimated_cost = (Decimal(estimated_tokens) / 1000) * input_per_1k

        quota = await self._quota_repo.get_or_create(tenant_id, commit=False)
        balance_before = quota.balance

        transaction = BillingTransaction(
            tenant_id=tenant_id,
            api_key_id=api_key_id,
            trace_id=trace_id,
            type=TransactionType.DEDUCT,
            status=TransactionStatus.PENDING,
            amount=estimated_cost,
            input_tokens=0,
            output_tokens=0,
            input_price=Decimal("0"),
            output_price=Decimal("0"),
            provider=provider,
            model=model,
            preset_item_id=preset_item_id,
            balance_before=balance_before,
            balance_after=balance_before,
            description="Stream billing (pending)",
        )
        self.session.add(transaction)
        await self.session.flush()
        return transaction

    async def commit_pending_transaction(
        self,
        trace_id: str,
        input_tokens: int,
        output_tokens: int,
        input_price: Decimal | float,
        output_price: Decimal | float,
        allow_negative: bool = True,
        **_: object,
    ) -> BillingTransaction:
        """
        提交 PENDING 交易：
        - 计算实际费用
        - 使用 Redis Lua 原子扣减
        - 更新交易为 COMMITTED
        """
        tx = await self.get_by_trace_id(trace_id)
        if not tx:
            raise ValueError(f"Transaction not found: {trace_id}")
        if tx.status == TransactionStatus.COMMITTED:
            return tx
        if tx.status != TransactionStatus.PENDING:
            raise ValueError(f"Invalid transaction status: {tx.status}")

        input_price = Decimal(str(input_price))
        output_price = Decimal(str(output_price))
        input_cost = (Decimal(input_tokens) / 1000) * input_price
        output_cost = (Decimal(output_tokens) / 1000) * output_price
        actual_cost = input_cost + output_cost

        try:
            updated_quota = await self._deduct_quota_redis(
                tenant_id=tx.tenant_id,
                amount=actual_cost,
                daily_requests=1,
                monthly_requests=1,
                allow_negative=allow_negative,
            )
        except InsufficientQuotaError as e:
            tx.status = TransactionStatus.FAILED
            tx.description = f"Insufficient balance: {e}"
            await self.session.flush()
            raise InsufficientBalanceError(actual_cost, Decimal(str(e.available))) from e

        tx.amount = actual_cost
        tx.input_tokens = input_tokens
        tx.output_tokens = output_tokens
        tx.input_price = input_price
        tx.output_price = output_price
        tx.balance_after = updated_quota.balance
        tx.status = TransactionStatus.COMMITTED
        await self.session.flush()

        await self._sync_redis_hash_after_commit(updated_quota)
        return tx

    async def record_transaction(
        self,
        tenant_id: str | uuid.UUID,
        amount: Decimal | float,
        trace_id: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        input_price: Decimal | float = Decimal("0"),
        output_price: Decimal | float = Decimal("0"),
        provider: str | None = None,
        model: str | None = None,
        preset_item_id: str | uuid.UUID | None = None,
        api_key_id: str | uuid.UUID | None = None,
        description: str | None = None,
    ) -> BillingTransaction:
        """
        只记录交易流水，不扣减配额（P0-1）
        
        配额已在 QuotaCheckStep 扣减，此处只记录交易。
        
        Args:
            tenant_id: 租户 ID
            amount: 交易金额
            trace_id: 请求追踪 ID（幂等键）
            input_tokens: 输入 Token 数
            output_tokens: 输出 Token 数
            input_price: 输入价格
            output_price: 输出价格
            provider: 提供商
            model: 模型名称
            preset_item_id: 路由配置项 ID
            api_key_id: API Key ID
            description: 交易说明

        Returns:
            交易记录

        Raises:
            DuplicateTransactionError: 重复交易
        """
        if isinstance(tenant_id, str):
            tenant_id = uuid.UUID(tenant_id)
        if isinstance(preset_item_id, str):
            preset_item_id = uuid.UUID(preset_item_id)
        if isinstance(api_key_id, str):
            api_key_id = uuid.UUID(api_key_id)

        amount = Decimal(str(amount))
        input_price = Decimal(str(input_price))
        output_price = Decimal(str(output_price))

        # 检查幂等键
        existing = await self.get_by_trace_id(trace_id)
        if existing:
            if existing.status == TransactionStatus.COMMITTED:
                logger.info(f"billing_record_idempotent_hit trace_id={trace_id}")
                return existing
            raise DuplicateTransactionError(trace_id)

        # 获取当前余额（从 DB）
        quota = await self._quota_repo.get_or_create(tenant_id, commit=False)
        balance_before = quota.balance
        balance_after = balance_before  # 不扣减余额

        # 创建交易记录（直接 COMMITTED）
        transaction = BillingTransaction(
            tenant_id=tenant_id,
            api_key_id=api_key_id,
            trace_id=trace_id,
            type=TransactionType.DEDUCT,
            status=TransactionStatus.COMMITTED,
            amount=amount,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            input_price=input_price,
            output_price=output_price,
            provider=provider,
            model=model,
            preset_item_id=preset_item_id,
            balance_before=balance_before,
            balance_after=balance_after,
            description=description or "Transaction recorded (quota deducted in quota_check)",
        )
        self.session.add(transaction)
        await self.session.flush()

        logger.info(
            "billing_record_success tenant=%s amount=%s trace_id=%s balance=%s",
            tenant_id,
            amount,
            trace_id,
            balance_after,
        )
        return transaction

    async def adjust_redis_balance(
        self,
        tenant_id: str | uuid.UUID,
        amount_diff: Decimal | float,
    ) -> None:
        """
        调整 Redis 余额差额（P0-1）
        
        当实际费用与预估费用有差异时，调整 Redis 中的余额。
        
        Args:
            tenant_id: 租户 ID
            amount_diff: 差额（正数表示实际费用更高，需要额外扣减；负数表示实际费用更低，需要返还）
        """
        if isinstance(tenant_id, str):
            tenant_id = uuid.UUID(tenant_id)

        amount_diff = Decimal(str(amount_diff))
        if abs(float(amount_diff)) < 0.000001:
            return  # 差额太小，忽略

        redis_client = getattr(cache, "_redis", None)
        if not redis_client:
            logger.debug("adjust_redis_balance_skipped tenant=%s (redis unavailable)", tenant_id)
            return

        try:
            key = CacheKeys.quota_hash(str(tenant_id))
            full_key = cache._make_key(key)
            
            # 使用 Lua 脚本原子调整余额
            lua_script = """
            local balance = redis.call("HGET", KEYS[1], "balance")
            if not balance then
                return 0
            end
            local new_balance = tonumber(balance) - tonumber(ARGV[1])
            redis.call("HSET", KEYS[1], "balance", tostring(new_balance))
            local version = redis.call("HGET", KEYS[1], "version")
            if version then
                redis.call("HSET", KEYS[1], "version", tostring(tonumber(version) + 1))
            end
            return 1
            """
            
            result = await redis_client.eval(lua_script, 1, full_key, str(amount_diff))
            if result:
                logger.debug(
                    "adjust_redis_balance_success tenant=%s diff=%s",
                    tenant_id,
                    amount_diff,
                )
            else:
                logger.warning(
                    "adjust_redis_balance_failed tenant=%s (key not found)",
                    tenant_id,
                )
        except Exception as exc:
            logger.error(
                "adjust_redis_balance_error tenant=%s err=%s",
                tenant_id,
                exc,
            )

    async def deduct(
        self,
        tenant_id: str | uuid.UUID,
        amount: Decimal | float,
        trace_id: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        input_price: Decimal | float = Decimal("0"),
        output_price: Decimal | float = Decimal("0"),
        provider: str | None = None,
        model: str | None = None,
        preset_item_id: str | uuid.UUID | None = None,
        api_key_id: str | uuid.UUID | None = None,
        description: str | None = None,
        allow_negative: bool = False,
    ) -> BillingTransaction:
        """
        扣费（带幂等键防重）

        流程：
        1. 检查幂等键，已存在则返回已有记录
        2. 检查余额是否充足
        3. 创建 PENDING 状态交易记录
        4. 扣减余额
        5. 更新交易状态为 COMMITTED

        Args:
            tenant_id: 租户 ID
            amount: 扣费金额
            trace_id: 请求追踪 ID（幂等键）
            input_tokens: 输入 Token 数
            output_tokens: 输出 Token 数
            input_price: 输入价格
            output_price: 输出价格
            provider: 提供商
            model: 模型名称
            preset_item_id: 路由配置项 ID
            api_key_id: API Key ID
            description: 交易说明
            allow_negative: 是否允许余额为负

        Returns:
            扣费交易记录

        Raises:
            InsufficientBalanceError: 余额不足
            DuplicateTransactionError: 重复交易
        """
        if isinstance(tenant_id, str):
            tenant_id = uuid.UUID(tenant_id)
        if isinstance(preset_item_id, str):
            preset_item_id = uuid.UUID(preset_item_id)
        if isinstance(api_key_id, str):
            api_key_id = uuid.UUID(api_key_id)

        amount = Decimal(str(amount))
        input_price = Decimal(str(input_price))
        output_price = Decimal(str(output_price))

        # 1. Redis 幂等键（快速拦截）
        redis_key = CacheKeys.billing_deduct_idempotency(str(tenant_id), trace_id)
        idempotent_locked = await cache.set(redis_key, "1", ttl=86400, nx=True)
        if not idempotent_locked:
            logger.warning(f"billing_redis_idempotent_hit trace_id={trace_id}")
            existing = await self.get_by_trace_id(trace_id)
            if existing and existing.status == TransactionStatus.COMMITTED:
                return existing
            raise DuplicateTransactionError(trace_id)

        # 2. DB 幂等键
        existing = await self.get_by_trace_id(trace_id)
        if existing:
            if existing.status == TransactionStatus.COMMITTED:
                logger.info(f"billing_idempotent_hit trace_id={trace_id}")
                return existing
            raise DuplicateTransactionError(trace_id)

        updated_quota: TenantQuota | None = None
        try:
            async with self.session.begin_nested():
                quota = await self._quota_repo.get_or_create(tenant_id, commit=False)
                balance_before = quota.balance

                transaction = BillingTransaction(
                    tenant_id=tenant_id,
                    api_key_id=api_key_id,
                    trace_id=trace_id,
                    type=TransactionType.DEDUCT,
                    status=TransactionStatus.PENDING,
                    amount=amount,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    input_price=input_price,
                    output_price=output_price,
                    provider=provider,
                    model=model,
                    preset_item_id=preset_item_id,
                    balance_before=balance_before,
                    balance_after=balance_before - amount,
                    description=description,
                )
                self.session.add(transaction)
                await self.session.flush()

                updated_quota = await self._deduct_quota_redis(
                    tenant_id=tenant_id,
                    amount=amount,
                    daily_requests=1,
                    monthly_requests=1,
                    allow_negative=allow_negative,
                )

                transaction.status = TransactionStatus.COMMITTED
                transaction.balance_after = updated_quota.balance
                await self.session.flush()

        except InsufficientQuotaError as e:
            await cache.delete(redis_key)
            raise InsufficientBalanceError(amount, Decimal(str(e.available))) from e
        except Exception:
            await cache.delete(redis_key)
            raise

        await self._sync_redis_hash_after_commit(updated_quota)

        logger.info(
            "billing_deduct_success tenant=%s amount=%s trace_id=%s balance_after=%s",
            tenant_id,
            amount,
            trace_id,
            updated_quota.balance if updated_quota else None,
        )
        return transaction

    async def _deduct_quota_redis(
        self,
        tenant_id: uuid.UUID,
        amount: Decimal,
        daily_requests: int,
        monthly_requests: int,
        allow_negative: bool,
    ) -> TenantQuota:
        """使用 Lua 脚本原子扣减，失败回退 DB 实现"""
        redis_client = getattr(cache, "_redis", None)
        if not redis_client:
            return await self._deduct_quota_db(tenant_id, amount, daily_requests, monthly_requests, allow_negative)

        script_sha = cache.get_script_sha("quota_deduct")
        if not script_sha:
            await cache.preload_scripts()
            script_sha = cache.get_script_sha("quota_deduct")

        if not script_sha:
            return await self._deduct_quota_db(tenant_id, amount, daily_requests, monthly_requests, allow_negative)

        key = CacheKeys.quota_hash(str(tenant_id))
        exists = await redis_client.exists(cache._make_key(key))
        if not exists:
            quota_snapshot = await self._quota_repo.get_or_create(tenant_id, commit=False)
            await self._quota_repo._sync_redis_hash(quota_snapshot)

        today = self._today_str()
        month = self._month_str()

        result = await redis_client.evalsha(
            script_sha,
            1,
            cache._make_key(key),
            str(amount),
            str(daily_requests),
            str(monthly_requests),
            today,
            month,
            "1" if allow_negative else "0",
        )

        if result[0] == 0:
            err = result[1]
            if err == "INSUFFICIENT_BALANCE":
                raise InsufficientQuotaError("balance", float(result[2]), float(result[4]))
            if err == "DAILY_QUOTA_EXCEEDED":
                raise InsufficientQuotaError("daily", float(result[2]), float(result[3]))
            if err == "MONTHLY_QUOTA_EXCEEDED":
                raise InsufficientQuotaError("monthly", float(result[2]), float(result[3]))
            raise InsufficientQuotaError("unknown", 0, 0)

        quota = await self._quota_repo.get_or_create(tenant_id, commit=False)
        quota.balance = Decimal(str(result[2]))
        quota.daily_used = int(result[3])
        quota.monthly_used = int(result[4])
        quota.version = int(result[5])
        await self.session.flush()
        return quota

    async def _deduct_quota_db(
        self,
        tenant_id: uuid.UUID,
        amount: Decimal,
        daily_requests: int,
        monthly_requests: int,
        allow_negative: bool,
    ) -> TenantQuota:
        """Redis 不可用时的 DB 回退"""
        return await self._quota_repo.check_and_deduct(
            tenant_id=tenant_id,
            balance_amount=amount,
            daily_requests=daily_requests,
            monthly_requests=monthly_requests,
            allow_negative=allow_negative,
            commit=False,
            sync_cache=False,
            invalidate_cache=False,
        )

    async def _sync_redis_hash_after_commit(self, quota: TenantQuota | None) -> None:
        """注册 after_commit 钩子确保事务成功后再同步 Redis"""
        if quota is None:
            return

        @event.listens_for(self.session.sync_session, "after_commit", once=True)
        def _sync(_session):  # noqa: ANN001
            asyncio.create_task(self._sync_redis_hash(quota))

    async def _sync_redis_hash(self, quota: TenantQuota) -> None:
        """同步 Redis Hash 供 Lua 脚本使用"""
        try:
            redis_client = getattr(cache, "_redis", None)
            if not redis_client:
                return
            key = CacheKeys.quota_hash(str(quota.tenant_id))
            payload = {
                "balance": str(quota.balance),
                "credit_limit": str(quota.credit_limit),
                "daily_quota": str(quota.daily_quota),
                "daily_used": str(quota.daily_used),
                "daily_date": quota.daily_reset_at.isoformat() if quota.daily_reset_at else self._today_str(),
                "monthly_quota": str(quota.monthly_quota),
                "monthly_used": str(quota.monthly_used),
                "monthly_month": quota.monthly_reset_at.strftime("%Y-%m") if quota.monthly_reset_at else self._month_str(),
                "version": str(quota.version),
            }
            await redis_client.hset(cache._make_key(key), mapping=payload)
            await redis_client.expire(cache._make_key(key), 86400)
        except Exception as exc:  # noqa: PERF203
            logger.error(f"sync_redis_hash_failed tenant={quota.tenant_id} err={exc}")

    @staticmethod
    def _today_str() -> str:
        from datetime import date
        return date.today().isoformat()

    @staticmethod
    def _month_str() -> str:
        from datetime import date
        d = date.today()
        return f"{d.year:04d}-{d.month:02d}"

    async def recharge(
        self,
        tenant_id: str | uuid.UUID,
        amount: Decimal | float,
        trace_id: str,
        description: str | None = None,
    ) -> BillingTransaction:
        """充值"""
        if isinstance(tenant_id, str):
            tenant_id = uuid.UUID(tenant_id)

        amount = Decimal(str(amount))

        # 检查幂等键
        existing = await self.get_by_trace_id(trace_id)
        if existing:
            if existing.status == TransactionStatus.COMMITTED:
                return existing
            raise DuplicateTransactionError(trace_id)

        # 获取当前余额
        quota = await self._quota_repo.get_or_create(tenant_id)
        balance_before = quota.balance
        balance_after = balance_before + amount

        # 创建交易记录
        transaction = BillingTransaction(
            tenant_id=tenant_id,
            trace_id=trace_id,
            type=TransactionType.RECHARGE,
            status=TransactionStatus.PENDING,
            amount=amount,
            balance_before=balance_before,
            balance_after=balance_after,
            description=description,
        )

        self.session.add(transaction)
        await self.session.flush()

        # 增加余额
        await self._quota_repo.add_balance(tenant_id, amount)

        # 更新交易状态
        transaction.status = TransactionStatus.COMMITTED
        await self.session.commit()
        await self.session.refresh(transaction)

        logger.info(f"billing_recharge_success tenant={tenant_id} amount={amount} balance_after={balance_after}")

        return transaction

    async def reverse(
        self,
        original_trace_id: str,
        reverse_trace_id: str,
        description: str | None = None,
    ) -> BillingTransaction:
        """
        冲正交易

        将原交易金额返还给租户
        """
        # 查找原交易
        original = await self.get_by_trace_id(original_trace_id)
        if not original:
            raise ValueError(f"Original transaction not found: {original_trace_id}")

        if original.status == TransactionStatus.REVERSED:
            raise ValueError(f"Transaction already reversed: {original_trace_id}")

        if original.type != TransactionType.DEDUCT:
            raise ValueError(f"Can only reverse deduct transactions: {original.type}")

        # 检查冲正交易幂等键
        existing = await self.get_by_trace_id(reverse_trace_id)
        if existing:
            if existing.status == TransactionStatus.COMMITTED:
                return existing
            raise DuplicateTransactionError(reverse_trace_id)

        # 获取当前余额
        quota = await self._quota_repo.get_or_create(original.tenant_id)
        balance_before = quota.balance
        balance_after = balance_before + original.amount

        # 创建冲正交易
        reverse_tx = BillingTransaction(
            tenant_id=original.tenant_id,
            api_key_id=original.api_key_id,
            trace_id=reverse_trace_id,
            type=TransactionType.REFUND,
            status=TransactionStatus.PENDING,
            amount=original.amount,
            input_tokens=original.input_tokens,
            output_tokens=original.output_tokens,
            input_price=original.input_price,
            output_price=original.output_price,
            provider=original.provider,
            model=original.model,
            preset_item_id=original.preset_item_id,
            balance_before=balance_before,
            balance_after=balance_after,
            description=description or f"Reverse of {original_trace_id}",
        )

        self.session.add(reverse_tx)
        await self.session.flush()

        # 返还余额
        await self._quota_repo.add_balance(original.tenant_id, original.amount)

        # 更新原交易状态
        original.status = TransactionStatus.REVERSED
        original.reversed_by = reverse_tx.id

        # 更新冲正交易状态
        reverse_tx.status = TransactionStatus.COMMITTED
        await self.session.commit()

        logger.info(f"billing_reverse_success original={original_trace_id} reverse={reverse_trace_id}")

        return reverse_tx

    async def get_by_trace_id(self, trace_id: str) -> BillingTransaction | None:
        """根据 trace_id 获取交易记录"""
        stmt = select(BillingTransaction).where(BillingTransaction.trace_id == trace_id)
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def get_by_id(self, transaction_id: str | uuid.UUID) -> BillingTransaction | None:
        """根据 ID 获取交易记录"""
        if isinstance(transaction_id, str):
            transaction_id = uuid.UUID(transaction_id)
        stmt = select(BillingTransaction).where(BillingTransaction.id == transaction_id)
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def list_transactions(
        self,
        tenant_id: str | uuid.UUID,
        limit: int = 50,
        offset: int = 0,
        status: TransactionStatus | None = None,
        type_filter: TransactionType | None = None,
        model: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
    ) -> list[BillingTransaction]:
        """查询交易记录"""
        if isinstance(tenant_id, str):
            tenant_id = uuid.UUID(tenant_id)

        conditions = [BillingTransaction.tenant_id == tenant_id]

        if status:
            conditions.append(BillingTransaction.status == status)
        if type_filter:
            conditions.append(BillingTransaction.type == type_filter)
        if model:
            conditions.append(BillingTransaction.model == model)
        if start_time:
            conditions.append(BillingTransaction.created_at >= start_time)
        if end_time:
            conditions.append(BillingTransaction.created_at <= end_time)

        stmt = (
            select(BillingTransaction)
            .where(and_(*conditions))
            .order_by(BillingTransaction.created_at.desc())
            .limit(limit)
            .offset(offset)
        )

        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_usage_summary(
        self,
        tenant_id: str | uuid.UUID,
        start_time: datetime,
        end_time: datetime,
    ) -> dict:
        """获取用量汇总"""
        transactions = await self.list_transactions(
            tenant_id=tenant_id,
            limit=10000,
            status=TransactionStatus.COMMITTED,
            type_filter=TransactionType.DEDUCT,
            start_time=start_time,
            end_time=end_time,
        )

        total_amount = Decimal("0")
        total_input_tokens = 0
        total_output_tokens = 0
        total_requests = 0
        by_model: dict[str, dict] = {}

        for tx in transactions:
            total_amount += tx.amount
            total_input_tokens += tx.input_tokens
            total_output_tokens += tx.output_tokens
            total_requests += 1

            model_key = tx.model or "unknown"
            if model_key not in by_model:
                by_model[model_key] = {
                    "amount": Decimal("0"),
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "requests": 0,
                }
            by_model[model_key]["amount"] += tx.amount
            by_model[model_key]["input_tokens"] += tx.input_tokens
            by_model[model_key]["output_tokens"] += tx.output_tokens
            by_model[model_key]["requests"] += 1

        return {
            "total_amount": float(total_amount),
            "total_input_tokens": total_input_tokens,
            "total_output_tokens": total_output_tokens,
            "total_requests": total_requests,
            "by_model": {
                k: {
                    "amount": float(v["amount"]),
                    "input_tokens": v["input_tokens"],
                    "output_tokens": v["output_tokens"],
                    "requests": v["requests"],
                }
                for k, v in by_model.items()
            },
        }

    async def _commit_transaction(self, transaction: BillingTransaction) -> BillingTransaction:
        """尝试完成 PENDING 状态的交易"""
        if transaction.status != TransactionStatus.PENDING:
            return transaction

        # 检查余额是否已扣减（通过比较当前余额和预期余额）
        quota = await self._quota_repo.get_or_create(transaction.tenant_id)

        # 如果余额已经低于预期，说明扣减已执行，直接更新状态
        if quota.balance <= transaction.balance_after:
            transaction.status = TransactionStatus.COMMITTED
            await self.session.commit()
            await self.session.refresh(transaction)
            return transaction

        # 否则需要执行扣减
        try:
            await self._quota_repo.check_and_deduct(
                tenant_id=transaction.tenant_id,
                balance_amount=transaction.amount,
                allow_negative=True,
            )
            transaction.status = TransactionStatus.COMMITTED
            await self.session.commit()
            await self.session.refresh(transaction)
        except Exception as e:
            logger.error(f"billing_commit_failed trace_id={transaction.trace_id}: {e}")
            raise

        return transaction
