"""
BillingRepository: 计费流水管理

提供基于 BillingTransaction 表的计费管理：
- 扣费流水记录（幂等防重、两阶段提交）
- 余额查询与扣减（与 QuotaRepository 联动）
- 冲正处理
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.cache_invalidation import CacheInvalidator
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
        self._invalidator = CacheInvalidator()
        self._quota_repo = QuotaRepository(session)

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

        # 0. Redis 幂等键检查 (快速拦截)
        redis_key = CacheKeys.billing_deduct_idempotency(str(tenant_id), trace_id)
        # 尝试设置 NX，有效期 24 小时
        idempotent_locked = await cache.set(redis_key, "1", ttl=86400, nx=True)
        if not idempotent_locked:
            logger.warning(f"billing_redis_idempotent_hit trace_id={trace_id}")
            existing = await self.get_by_trace_id(trace_id)
            if existing and existing.status == TransactionStatus.COMMITTED:
                return existing
            raise DuplicateTransactionError(trace_id)

        # 1. 检查幂等键 (DB)
        existing = await self.get_by_trace_id(trace_id)
        if existing:
            if existing.status == TransactionStatus.COMMITTED:
                logger.info(f"billing_idempotent_hit trace_id={trace_id}")
                return existing
            elif existing.status == TransactionStatus.PENDING:
                # 尝试完成之前的 PENDING 交易
                logger.warning(f"billing_pending_retry trace_id={trace_id}")
                return await self._commit_transaction(existing)
            else:
                raise DuplicateTransactionError(trace_id)

        # 2. 事务内处理：写交易 + 扣减配额（避免部分提交）
        updated_quota: TenantQuota | None = None
        try:
            tx_ctx = self.session.begin_nested() if self.session.in_transaction() else self.session.begin()
            async with tx_ctx:
                quota = await self._quota_repo.get_or_create(tenant_id, commit=False)
                balance_before = quota.balance
                effective_balance = quota.balance + quota.credit_limit

                # 3. 检查余额
                if not allow_negative and effective_balance < amount:
                    raise InsufficientBalanceError(amount, effective_balance)

                balance_after = balance_before - amount

                # 4. 创建 PENDING 交易记录
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
                    balance_after=balance_after,
                    description=description,
                )

                try:
                    self.session.add(transaction)
                    await self.session.flush()
                except Exception:
                    # 可能是唯一约束冲突（幂等键）
                    existing = await self.get_by_trace_id(trace_id)
                    if existing:
                        logger.info(f"billing_idempotent_conflict trace_id={trace_id}")
                        return existing
                    raise

                # 5. 扣减余额（不立即提交，交由外层事务）
                try:
                    updated_quota = await self._quota_repo.check_and_deduct(
                        tenant_id=tenant_id,
                        balance_amount=amount,
                        daily_requests=1,
                        monthly_requests=1,
                        tokens=input_tokens + output_tokens,
                        allow_negative=allow_negative,
                        commit=False,
                        sync_cache=False,
                        invalidate_cache=False,
                    )
                except InsufficientQuotaError as e:
                    raise InsufficientBalanceError(amount, Decimal(str(e.available))) from e

                # 6. 更新交易状态为 COMMITTED
                transaction.status = TransactionStatus.COMMITTED
                # 将更新持久化由 context manager 负责 commit
                await self.session.flush()

        except Exception:
            # 失败时释放幂等键，允许重试
            if idempotent_locked:
                try:
                    await cache.delete(redis_key)
                except Exception:
                    pass
            raise

        # 事务提交后同步缓存/Redis
        if updated_quota:
            await self._quota_repo._invalidate_cache(str(tenant_id))
            await self._quota_repo._sync_redis_hash(updated_quota)

        logger.info(
            f"billing_deduct_success tenant={tenant_id} amount={amount} "
            f"trace_id={trace_id} balance_after={balance_after}"
        )

        return transaction

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
