# 从零开始的最优计费与配额方案 (Part 2)

## 💻 核心代码实现 (续)

### 2. BillingStep (统一计费路径)

```python
# backend/app/services/workflow/steps/billing.py

@step_registry.register
class BillingStep(BaseStep):
    """
    计费步骤 (统一流式和非流式)
    
    设计原则:
    - 流式和非流式使用相同的计费逻辑
    - 流式使用两阶段提交 (PENDING -> COMMITTED)
    - 非流式直接提交
    - 使用 Redis Lua 脚本原子扣减配额
    - 事务提交后异步同步 Redis Hash
    """
    
    name = "billing"
    depends_on = ["response_transform"]
    
    async def execute(self, ctx: "WorkflowContext") -> StepResult:
        """执行计费"""
        # 检查是否流式
        is_stream = ctx.get("upstream_call", "stream", False)
        
        if is_stream:
            # 流式：创建 PENDING 交易
            return await self._create_pending_for_stream(ctx)
        else:
            # 非流式：正常扣费
            return await self._deduct_for_non_stream(ctx)
    
    async def _create_pending_for_stream(self, ctx: "WorkflowContext") -> StepResult:
        """
        为流式请求创建 PENDING 交易
        
        流程:
        1. 估算 tokens (用于预检查余额)
        2. 创建 PENDING 交易记录
        3. 不扣减余额 (等流完成后再扣)
        4. 返回交易 ID 供后续提交
        """
        # 获取定价配置
        pricing = ctx.get("routing", "pricing_config") or {}
        
        if not pricing or not ctx.is_external or not ctx.tenant_id:
            # 无需计费
            ctx.set("billing", "skip_reason", "no_pricing_or_internal")
            return StepResult(status=StepStatus.SUCCESS)
        
        # 估算 tokens (用于预检查余额)
        request = ctx.get("validation", "request")
        estimated_tokens = getattr(request, "max_tokens", 4096) if request else 4096
        
        try:
            repo = BillingRepository(ctx.db_session)
            transaction = await repo.create_pending_transaction(
                tenant_id=ctx.tenant_id,
                trace_id=ctx.trace_id,
                estimated_tokens=estimated_tokens,
                pricing=pricing,
                api_key_id=ctx.api_key_id,
                provider=ctx.upstream_result.provider,
                model=ctx.requested_model,
                preset_item_id=ctx.get("routing", "provider_model_id"),
            )
            
            # 保存交易 ID 供流完成后提交
            ctx.set("billing", "pending_transaction_id", str(transaction.id))
            ctx.set("billing", "pending_trace_id", ctx.trace_id)
            ctx.set("billing", "pricing_config", pricing)
            
            logger.info(f"Created pending billing transaction trace_id={ctx.trace_id}")
            
            return StepResult(
                status=StepStatus.SUCCESS,
                data={"pending_transaction_id": str(transaction.id)}
            )
            
        except InsufficientBalanceError as e:
            # 余额不足，拒绝请求
            ctx.mark_error(
                ErrorSource.GATEWAY,
                "INSUFFICIENT_BALANCE",
                f"Insufficient balance: required={e.required}, available={e.available}",
            )
            return StepResult(
                status=StepStatus.FAILED,
                message="Payment required: insufficient balance",
                data={
                    "error_code": "INSUFFICIENT_BALANCE",
                    "http_status": 402,
                    "required": float(e.required),
                    "available": float(e.available),
                },
            )
    
    async def _deduct_for_non_stream(self, ctx: "WorkflowContext") -> StepResult:
        """
        非流式请求的正常扣费逻辑
        
        流程:
        1. 计算费用
        2. 调用 BillingRepository.deduct()
        3. 更新 Context
        """
        # 获取 token 用量
        input_tokens = ctx.billing.input_tokens
        output_tokens = ctx.billing.output_tokens
        
        # 获取定价配置
        pricing = ctx.get("routing", "pricing_config") or {}
        
        if not pricing or not ctx.is_external or not ctx.tenant_id:
            # 无需计费
            ctx.set("billing", "skip_reason", "no_pricing_or_internal")
            return StepResult(status=StepStatus.SUCCESS)
        
        # 计算费用
        input_cost = self._calculate_cost(input_tokens, pricing.get("input_per_1k", 0))
        output_cost = self._calculate_cost(output_tokens, pricing.get("output_per_1k", 0))
        total_cost = input_cost + output_cost
        currency = pricing.get("currency", "USD")
        
        # 更新 billing 信息
        ctx.billing.input_cost = input_cost
        ctx.billing.output_cost = output_cost
        ctx.billing.total_cost = total_cost
        ctx.billing.currency = currency
        
        # 扣减余额
        try:
            repo = BillingRepository(ctx.db_session)
            transaction = await repo.deduct(
                tenant_id=ctx.tenant_id,
                amount=Decimal(str(total_cost)),
                trace_id=ctx.trace_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                input_price=Decimal(str(pricing.get("input_per_1k", 0))),
                output_price=Decimal(str(pricing.get("output_per_1k", 0))),
                provider=ctx.upstream_result.provider,
                model=ctx.requested_model,
                preset_item_id=ctx.get("routing", "provider_model_id"),
                api_key_id=ctx.api_key_id,
                allow_negative=False,
            )
            
            ctx.set("billing", "balance_after", float(transaction.balance_after))
            
            logger.info(
                f"Billing completed trace_id={ctx.trace_id} "
                f"tokens={ctx.billing.total_tokens} "
                f"cost={total_cost:.6f} {currency}"
            )
            
            return StepResult(
                status=StepStatus.SUCCESS,
                data={
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_cost": total_cost,
                    "currency": currency,
                },
            )
            
        except InsufficientBalanceError as e:
            logger.error(f"Insufficient balance: {e}")
            ctx.mark_error(
                ErrorSource.GATEWAY,
                "INSUFFICIENT_BALANCE",
                str(e),
            )
            return StepResult(
                status=StepStatus.FAILED,
                message="Payment required: insufficient balance",
                data={
                    "error_code": "INSUFFICIENT_BALANCE",
                    "http_status": 402,
                    "required": float(e.required),
                    "available": float(e.available),
                },
            )
    
    def _calculate_cost(self, tokens: int, price_per_1k: float) -> float:
        """计算费用（精确计算）"""
        if tokens <= 0 or price_per_1k <= 0:
            return 0.0
        
        # 使用 Decimal 避免浮点精度问题
        tokens_dec = Decimal(str(tokens))
        price_dec = Decimal(str(price_per_1k))
        cost = (tokens_dec / 1000) * price_dec
        
        return float(cost.quantize(Decimal("0.000001")))
```

### 3. BillingRepository (两阶段提交 + Lua 脚本扣减)

```python
# backend/app/repositories/billing_repository.py

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
        **kwargs
    ) -> BillingTransaction:
        """
        创建 PENDING 状态的交易（用于流式请求）
        
        流程：
        1. 创建 PENDING 交易记录
        2. 不扣减余额（等流完成后再扣）
        3. 返回交易 ID 供后续提交
        """
        if isinstance(tenant_id, str):
            tenant_id = uuid.UUID(tenant_id)
        
        # 检查幂等键
        existing = await self.get_by_trace_id(trace_id)
        if existing:
            return existing
        
        # 估算费用（用于预检查）
        estimated_cost = Decimal("0")
        if pricing and estimated_tokens > 0:
            input_per_1k = Decimal(str(pricing.get("input_per_1k", 0)))
            estimated_cost = (Decimal(estimated_tokens) / 1000) * input_per_1k
        
        # 获取当前余额
        quota = await self._quota_repo.get_or_create(tenant_id)
        balance_before = quota.balance
        
        # 创建 PENDING 交易
        transaction = BillingTransaction(
            tenant_id=tenant_id,
            trace_id=trace_id,
            type=TransactionType.DEDUCT,
            status=TransactionStatus.PENDING,
            amount=estimated_cost,
            balance_before=balance_before,
            balance_after=balance_before,  # 暂不扣减
            description="Stream billing (pending)",
            **kwargs
        )
        
        self.session.add(transaction)
        await self.session.flush()
        
        logger.info(f"Created pending transaction trace_id={trace_id}")
        return transaction
    
    async def commit_pending_transaction(
        self,
        trace_id: str,
        input_tokens: int,
        output_tokens: int,
        input_price: Decimal | float,
        output_price: Decimal | float,
        allow_negative: bool = True,
    ) -> BillingTransaction:
        """
        提交 PENDING 交易（流完成后调用）
        
        流程：
        1. 查找 PENDING 交易
        2. 计算实际费用
        3. 使用 Redis Lua 脚本原子扣减配额
        4. 更新交易状态为 COMMITTED
        5. 事务提交后异步同步 Redis Hash
        """
        # 查找 PENDING 交易
        transaction = await self.get_by_trace_id(trace_id)
        if not transaction:
            raise ValueError(f"Transaction not found: {trace_id}")
        
        if transaction.status == TransactionStatus.COMMITTED:
            logger.info(f"Transaction already committed: {trace_id}")
            return transaction
        
        if transaction.status != TransactionStatus.PENDING:
            raise ValueError(f"Invalid transaction status: {transaction.status}")
        
        # 计算实际费用
        input_price = Decimal(str(input_price))
        output_price = Decimal(str(output_price))
        input_cost = (Decimal(input_tokens) / 1000) * input_price
        output_cost = (Decimal(output_tokens) / 1000) * output_price
        actual_cost = input_cost + output_cost
        
        # 使用 Redis Lua 脚本原子扣减配额
        try:
            updated_quota = await self._deduct_quota_redis(
                tenant_id=transaction.tenant_id,
                amount=actual_cost,
                daily_requests=1,
                monthly_requests=1,
                allow_negative=allow_negative,
            )
        except InsufficientQuotaError as e:
            # 余额不足，标记为 FAILED
            transaction.status = TransactionStatus.FAILED
            transaction.description = f"Insufficient balance: {e}"
            await self.session.flush()
            raise InsufficientBalanceError(actual_cost, Decimal(str(e.available))) from e
        
        # 更新交易记录
        transaction.amount = actual_cost
        transaction.input_tokens = input_tokens
        transaction.output_tokens = output_tokens
        transaction.input_price = input_price
        transaction.output_price = output_price
        transaction.balance_after = updated_quota.balance
        transaction.status = TransactionStatus.COMMITTED
        transaction.description = "Stream billing (committed)"
        
        await self.session.flush()
        
        # 事务提交后异步同步 Redis Hash
        await self._sync_redis_hash_after_commit(updated_quota)
        
        logger.info(
            f"Committed pending transaction trace_id={trace_id} "
            f"amount={actual_cost} balance_after={updated_quota.balance}"
        )
        
        return transaction
    
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
        1. Redis 幂等键检查（快速拦截）
        2. DB 幂等键检查
        3. 创建 PENDING 交易记录
        4. 使用 Redis Lua 脚本原子扣减配额
        5. 更新交易状态为 COMMITTED
        6. 事务提交后异步同步 Redis Hash
        """
        if isinstance(tenant_id, str):
            tenant_id = uuid.UUID(tenant_id)
        
        amount = Decimal(str(amount))
        input_price = Decimal(str(input_price))
        output_price = Decimal(str(output_price))
        
        # 1. Redis 幂等键检查（快速拦截）
        redis_key = CacheKeys.billing_deduct_idempotency(str(tenant_id), trace_id)
        idempotent_locked = await cache.set(redis_key, "1", ttl=86400, nx=True)
        
        if not idempotent_locked:
            logger.warning(f"billing_redis_idempotent_hit trace_id={trace_id}")
            existing = await self.get_by_trace_id(trace_id)
            if existing and existing.status == TransactionStatus.COMMITTED:
                return existing
            raise DuplicateTransactionError(trace_id)
        
        # 2. DB 幂等键检查
        existing = await self.get_by_trace_id(trace_id)
        if existing:
            if existing.status == TransactionStatus.COMMITTED:
                logger.info(f"billing_idempotent_hit trace_id={trace_id}")
                return existing
            raise DuplicateTransactionError(trace_id)
        
        # 3. 事务内处理
        try:
            async with self.session.begin_nested():
                # 获取当前余额
                quota = await self._quota_repo.get_or_create(tenant_id, commit=False)
                balance_before = quota.balance
                
                # 创建 PENDING 交易记录
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
                
                # 4. 使用 Redis Lua 脚本原子扣减配额
                updated_quota = await self._deduct_quota_redis(
                    tenant_id=tenant_id,
                    amount=amount,
                    daily_requests=1,
                    monthly_requests=1,
                    allow_negative=allow_negative,
                )
                
                # 5. 更新交易状态为 COMMITTED
                transaction.status = TransactionStatus.COMMITTED
                transaction.balance_after = updated_quota.balance
                await self.session.flush()
        
        except InsufficientQuotaError as e:
            # 失败时释放幂等键
            await cache.delete(redis_key)
            raise InsufficientBalanceError(amount, Decimal(str(e.available))) from e
        except Exception:
            # 失败时释放幂等键
            await cache.delete(redis_key)
            raise
        
        # 6. 事务提交后异步同步 Redis Hash
        await self._sync_redis_hash_after_commit(updated_quota)
        
        logger.info(
            f"billing_deduct_success tenant={tenant_id} amount={amount} "
            f"trace_id={trace_id} balance_after={updated_quota.balance}"
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
        """
        使用 Redis Lua 脚本原子扣减配额
        
        流程：
        1. 调用 quota_deduct.lua 脚本
        2. 脚本返回扣减后的配额信息
        3. 更新 DB 中的配额记录（最终一致性）
        """
        redis_client = getattr(cache, "_redis", None)
        if not redis_client:
            # Redis 不可用，回退到 DB
            return await self._deduct_quota_db(
                tenant_id, amount, daily_requests, monthly_requests, allow_negative
            )
        
        # 加载 Lua 脚本
        script_sha = cache.get_script_sha("quota_deduct")
        if not script_sha:
            await cache.preload_scripts()
            script_sha = cache.get_script_sha("quota_deduct")
        
        if not script_sha:
            # 脚本加载失败，回退到 DB
            return await self._deduct_quota_db(
                tenant_id, amount, daily_requests, monthly_requests, allow_negative
            )
        
        # 调用 Lua 脚本
        key = CacheKeys.quota_hash(str(tenant_id))
        today = self._today_str()
        month = self._month_str()
        
        result = await redis_client.evalsha(
            script_sha,
            keys=[cache._make_key(key)],
            args=[
                str(amount),
                str(daily_requests),
                str(monthly_requests),
                today,
                month,
                "1" if allow_negative else "0",
            ]
        )
        
        # 解析结果
        # result: [success, message, new_balance, new_daily_used, new_monthly_used, version]
        if result[0] == 0:
            # 扣减失败
            error_type = result[1]
            if error_type == "INSUFFICIENT_BALANCE":
                raise InsufficientQuotaError("balance", float(result[2]), float(result[4]))
            elif error_type == "DAILY_QUOTA_EXCEEDED":
                raise InsufficientQuotaError("daily", float(result[2]), float(result[3]))
            elif error_type == "MONTHLY_QUOTA_EXCEEDED":
                raise InsufficientQuotaError("monthly", float(result[2]), float(result[3]))
            else:
                raise InsufficientQuotaError("unknown", 0, 0)
        
        # 扣减成功，更新 DB（最终一致性）
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
        """DB 回退路径（Redis 不可用时）"""
        return await self._quota_repo.check_and_deduct(
            tenant_id=tenant_id,
            balance_amount=amount,
            daily_requests=daily_requests,
            monthly_requests=monthly_requests,
            allow_negative=allow_negative,
            commit=False,
        )
    
    async def _sync_redis_hash_after_commit(self, quota: TenantQuota) -> None:
        """
        事务提交后异步同步 Redis Hash
        
        使用事务后钩子确保 DB 提交后才同步 Redis
        """
        # 注册事务后钩子
        @event.listens_for(self.session.sync_session, "after_commit", once=True)
        def sync_redis(session):
            # 在事务提交后异步同步 Redis
            asyncio.create_task(self._sync_redis_hash(quota))
        
    async def _sync_redis_hash(self, quota: TenantQuota) -> None:
        """同步 Redis Hash"""
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
            
            logger.debug(f"Synced Redis Hash for tenant={quota.tenant_id}")
        except Exception as e:
            logger.error(f"Failed to sync Redis Hash: {e}")
    
    @staticmethod
    def _today_str() -> str:
        from datetime import date
        return date.today().isoformat()
    
    @staticmethod
    def _month_str() -> str:
        from datetime import date
        d = date.today()
        return f"{d.year:04d}-{d.month:02d}"
    
    async def get_by_trace_id(self, trace_id: str) -> BillingTransaction | None:
        """根据 trace_id 获取交易记录"""
        stmt = select(BillingTransaction).where(BillingTransaction.trace_id == trace_id)
        result = await self.session.execute(stmt)
        return result.scalars().first()
```

