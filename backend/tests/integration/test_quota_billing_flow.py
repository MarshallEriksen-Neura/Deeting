"""
配额和计费流程集成测试

测试完整的请求流程：
1. QuotaCheckStep 原子扣减配额
2. UpstreamCall 调用上游
3. ResponseTransform 解析响应
4. BillingStep 记录流水并调整差额
5. 验证 Redis 和 DB 的一致性
"""

import uuid
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.cache_keys import CacheKeys
from app.models.billing import BillingTransaction, TenantQuota, TransactionStatus
from app.repositories.billing_repository import BillingRepository
from app.repositories.quota_repository import QuotaRepository
from app.services.orchestrator.context import Channel, WorkflowContext
from tests.api.conftest import AsyncSessionLocal


@pytest_asyncio.fixture
async def db_session() -> AsyncSession:
    """
    为配额计费测试提供独立的数据库会话
    
    注意：不使用 autouse 的 _force_routing_fallback，
    因为我们需要测试真实的配额和计费流程
    """
    async with AsyncSessionLocal() as session:
        yield session


@pytest.mark.asyncio
async def test_quota_billing_flow_non_stream(db_session):
    """
    测试非流式请求的完整配额和计费流程
    
    流程：
    1. 创建租户配额
    2. QuotaCheckStep 扣减预估费用
    3. BillingStep 记录实际费用并调整差额
    4. 验证 Redis 和 DB 的一致性
    """
    # 1. 准备测试数据
    tenant_id = str(uuid.uuid4())
    trace_id = f"test_trace_{uuid.uuid4()}"
    
    # 创建租户配额
    quota_repo = QuotaRepository(db_session)
    quota = await quota_repo.get_or_create(
        tenant_id=tenant_id,
        defaults={
            "balance": 100.0,
            "daily_quota": 1000,
            "monthly_quota": 10000,
        },
    )
    
    initial_balance = float(quota.balance)
    initial_daily_used = quota.daily_used
    initial_monthly_used = quota.monthly_used
    
    # 2. 模拟 QuotaCheckStep 扣减预估费用
    estimated_cost = 0.05  # 预估费用 $0.05
    
    # 调用 quota_deduct.lua 脚本
    redis_client = getattr(cache, "_redis", None)
    if redis_client:
        await cache.preload_scripts()
        script_sha = cache.get_script_sha("quota_deduct")
        
        key = CacheKeys.quota_hash(tenant_id)
        full_key = cache._make_key(key)
        
        # 预热缓存
        await quota_repo._sync_redis_hash(quota)
        
        # 执行扣减
        from datetime import date
        today = date.today().isoformat()
        month = f"{date.today().year:04d}-{date.today().month:02d}"
        
        result = await redis_client.evalsha(
            script_sha,
            keys=[full_key],
            args=[
                str(estimated_cost),  # amount
                "1",  # daily_requests
                "1",  # monthly_requests
                today,
                month,
                "0",  # allow_negative=False
            ],
        )
        
        assert result[0] == 1, f"Quota deduction failed: {result}"
        
        # 验证 Redis 中的余额已扣减
        redis_balance = await redis_client.hget(full_key, "balance")
        redis_balance = float(redis_balance)
        assert abs(redis_balance - (initial_balance - estimated_cost)) < 0.000001
    
    # 3. 模拟 BillingStep 记录实际费用
    actual_input_tokens = 100
    actual_output_tokens = 200
    input_price = Decimal("0.0001")  # $0.0001 per 1k tokens
    output_price = Decimal("0.0002")  # $0.0002 per 1k tokens
    
    actual_input_cost = (Decimal(actual_input_tokens) / 1000) * input_price
    actual_output_cost = (Decimal(actual_output_tokens) / 1000) * output_price
    actual_total_cost = float(actual_input_cost + actual_output_cost)
    
    # 记录交易流水
    billing_repo = BillingRepository(db_session)
    transaction = await billing_repo.record_transaction(
        tenant_id=tenant_id,
        amount=Decimal(str(actual_total_cost)),
        trace_id=trace_id,
        input_tokens=actual_input_tokens,
        output_tokens=actual_output_tokens,
        input_price=input_price,
        output_price=output_price,
        provider="openai",
        model="gpt-4",
        description="Test transaction",
    )
    
    assert transaction.status == TransactionStatus.COMMITTED
    assert float(transaction.amount) == actual_total_cost
    
    # 4. 调整费用差额
    cost_diff = Decimal(str(actual_total_cost)) - Decimal(str(estimated_cost))
    if abs(float(cost_diff)) > 0.000001:
        await billing_repo.adjust_redis_balance(tenant_id, cost_diff)
    
    # 5. 验证 Redis 和 DB 的一致性
    if redis_client:
        # 从 Redis 读取最新余额
        redis_balance = await redis_client.hget(full_key, "balance")
        redis_balance = float(redis_balance)
        
        # 从 DB 读取最新配额（注意：DB 还未同步，所以余额应该是初始值）
        await db_session.refresh(quota)
        db_balance = float(quota.balance)
        
        # Redis 余额应该是：初始余额 - 实际费用
        expected_redis_balance = initial_balance - actual_total_cost
        assert abs(redis_balance - expected_redis_balance) < 0.000001, \
            f"Redis balance mismatch: {redis_balance} != {expected_redis_balance}"
        
        # DB 余额应该还是初始值（因为我们只记录了流水，没有扣减 DB）
        assert abs(db_balance - initial_balance) < 0.000001, \
            f"DB balance should not change: {db_balance} != {initial_balance}"
        
        # 验证日/月请求计数
        redis_daily_used = int(await redis_client.hget(full_key, "daily_used"))
        redis_monthly_used = int(await redis_client.hget(full_key, "monthly_used"))
        
        assert redis_daily_used == initial_daily_used + 1
        assert redis_monthly_used == initial_monthly_used + 1
    
    # 6. 验证交易记录
    stmt = select(BillingTransaction).where(BillingTransaction.trace_id == trace_id)
    result = await db_session.execute(stmt)
    saved_transaction = result.scalars().first()
    
    assert saved_transaction is not None
    assert saved_transaction.tenant_id == uuid.UUID(tenant_id)
    assert saved_transaction.status == TransactionStatus.COMMITTED
    assert float(saved_transaction.amount) == actual_total_cost
    assert saved_transaction.input_tokens == actual_input_tokens
    assert saved_transaction.output_tokens == actual_output_tokens


@pytest.mark.asyncio
async def test_quota_billing_flow_with_sync(db_session):
    """
    测试配额同步流程
    
    流程：
    1. 在 Redis 中扣减配额
    2. 执行周期性同步任务
    3. 验证 DB 中的配额已同步
    """
    # 1. 准备测试数据
    tenant_id = str(uuid.uuid4())
    
    # 创建租户配额
    quota_repo = QuotaRepository(db_session)
    quota = await quota_repo.get_or_create(
        tenant_id=tenant_id,
        defaults={
            "balance": 100.0,
            "daily_quota": 1000,
            "monthly_quota": 10000,
        },
    )
    
    initial_balance = float(quota.balance)
    
    # 2. 在 Redis 中扣减配额
    redis_client = getattr(cache, "_redis", None)
    if not redis_client:
        pytest.skip("Redis not available")
    
    await cache.preload_scripts()
    script_sha = cache.get_script_sha("quota_deduct")
    
    key = CacheKeys.quota_hash(tenant_id)
    full_key = cache._make_key(key)
    
    # 预热缓存
    await quota_repo._sync_redis_hash(quota)
    
    # 执行扣减
    from datetime import date
    today = date.today().isoformat()
    month = f"{date.today().year:04d}-{date.today().month:02d}"
    
    deduct_amount = 0.05
    result = await redis_client.evalsha(
        script_sha,
        keys=[full_key],
        args=[str(deduct_amount), "1", "1", today, month, "0"],
    )
    
    assert result[0] == 1
    
    # 3. 执行同步任务
    from app.tasks.quota_sync import sync_quota_from_redis_to_db_async
    
    sync_result = await sync_quota_from_redis_to_db_async(tenant_id, session=db_session)
    
    assert sync_result["status"] == "synced"
    assert abs(sync_result["balance_diff"] - deduct_amount) < 0.000001
    
    # 4. 验证 DB 中的配额已同步
    await db_session.refresh(quota)
    db_balance = float(quota.balance)
    
    expected_balance = initial_balance - deduct_amount
    assert abs(db_balance - expected_balance) < 0.000001, \
        f"DB balance not synced: {db_balance} != {expected_balance}"


@pytest.mark.asyncio
async def test_quota_insufficient_balance(db_session):
    """
    测试余额不足的情况
    
    验证：
    1. 余额不足时 quota_deduct.lua 返回失败
    2. 不会扣减配额
    """
    # 1. 准备测试数据（余额很少）
    tenant_id = str(uuid.uuid4())
    
    quota_repo = QuotaRepository(db_session)
    quota = await quota_repo.get_or_create(
        tenant_id=tenant_id,
        defaults={
            "balance": 0.01,  # 只有 $0.01
            "daily_quota": 1000,
            "monthly_quota": 10000,
        },
    )
    
    initial_balance = float(quota.balance)
    
    # 2. 尝试扣减超过余额的金额
    redis_client = getattr(cache, "_redis", None)
    if not redis_client:
        pytest.skip("Redis not available")
    
    await cache.preload_scripts()
    script_sha = cache.get_script_sha("quota_deduct")
    
    key = CacheKeys.quota_hash(tenant_id)
    full_key = cache._make_key(key)
    
    # 预热缓存
    await quota_repo._sync_redis_hash(quota)
    
    # 尝试扣减 $0.05（超过余额）
    from datetime import date
    today = date.today().isoformat()
    month = f"{date.today().year:04d}-{date.today().month:02d}"
    
    result = await redis_client.evalsha(
        script_sha,
        keys=[full_key],
        args=["0.05", "1", "1", today, month, "0"],
    )
    
    # 应该返回失败
    assert result[0] == 0
    assert result[1] == "INSUFFICIENT_BALANCE"
    
    # 验证余额未被扣减
    redis_balance = await redis_client.hget(full_key, "balance")
    redis_balance = float(redis_balance)
    assert abs(redis_balance - initial_balance) < 0.000001


@pytest.mark.asyncio
async def test_quota_daily_quota_exceeded(db_session):
    """
    测试日配额超限的情况
    """
    # 1. 准备测试数据（日配额已用完）
    tenant_id = str(uuid.uuid4())
    
    quota_repo = QuotaRepository(db_session)
    quota = await quota_repo.get_or_create(
        tenant_id=tenant_id,
        defaults={
            "balance": 100.0,
            "daily_quota": 10,
            "monthly_quota": 10000,
        },
    )
    
    # 手动设置日配额已用完
    from datetime import date
    quota.daily_used = 10
    quota.daily_reset_at = date.today()
    await db_session.commit()
    
    # 2. 尝试扣减
    redis_client = getattr(cache, "_redis", None)
    if not redis_client:
        pytest.skip("Redis not available")
    
    await cache.preload_scripts()
    script_sha = cache.get_script_sha("quota_deduct")
    
    key = CacheKeys.quota_hash(tenant_id)
    full_key = cache._make_key(key)
    
    # 预热缓存
    await quota_repo._sync_redis_hash(quota)
    
    # 尝试扣减
    today = date.today().isoformat()
    month = f"{date.today().year:04d}-{date.today().month:02d}"
    
    result = await redis_client.evalsha(
        script_sha,
        keys=[full_key],
        args=["0.01", "1", "1", today, month, "0"],
    )
    
    # 应该返回失败
    assert result[0] == 0
    assert result[1] == "DAILY_QUOTA_EXCEEDED"


@pytest.mark.asyncio
async def test_quota_cost_adjustment(db_session):
    """
    测试费用差额调整
    
    验证：
    1. 预估费用与实际费用不同时
    2. adjust_redis_balance 正确调整差额
    """
    # 1. 准备测试数据
    tenant_id = str(uuid.uuid4())
    
    quota_repo = QuotaRepository(db_session)
    quota = await quota_repo.get_or_create(
        tenant_id=tenant_id,
        defaults={"balance": 100.0},
    )
    
    initial_balance = float(quota.balance)
    
    # 2. 扣减预估费用
    redis_client = getattr(cache, "_redis", None)
    if not redis_client:
        pytest.skip("Redis not available")
    
    await cache.preload_scripts()
    script_sha = cache.get_script_sha("quota_deduct")
    
    key = CacheKeys.quota_hash(tenant_id)
    full_key = cache._make_key(key)
    
    await quota_repo._sync_redis_hash(quota)
    
    from datetime import date
    today = date.today().isoformat()
    month = f"{date.today().year:04d}-{date.today().month:02d}"
    
    estimated_cost = 0.05
    result = await redis_client.evalsha(
        script_sha,
        keys=[full_key],
        args=[str(estimated_cost), "1", "1", today, month, "0"],
    )
    assert result[0] == 1
    
    # 3. 调整费用差额（实际费用更高）
    actual_cost = 0.08
    cost_diff = Decimal(str(actual_cost)) - Decimal(str(estimated_cost))
    
    billing_repo = BillingRepository(db_session)
    await billing_repo.adjust_redis_balance(tenant_id, cost_diff)
    
    # 4. 验证 Redis 余额
    redis_balance = await redis_client.hget(full_key, "balance")
    redis_balance = float(redis_balance)
    
    expected_balance = initial_balance - actual_cost
    assert abs(redis_balance - expected_balance) < 0.000001, \
        f"Balance after adjustment: {redis_balance} != {expected_balance}"


@pytest.mark.asyncio
async def test_quota_idempotency(db_session):
    """
    测试幂等性
    
    验证：
    1. 相同 trace_id 的交易只记录一次
    2. 不会重复扣减配额
    """
    # 1. 准备测试数据
    tenant_id = str(uuid.uuid4())
    trace_id = f"test_trace_{uuid.uuid4()}"
    
    quota_repo = QuotaRepository(db_session)
    await quota_repo.get_or_create(
        tenant_id=tenant_id,
        defaults={"balance": 100.0},
    )
    
    # 2. 第一次记录交易
    billing_repo = BillingRepository(db_session)
    transaction1 = await billing_repo.record_transaction(
        tenant_id=tenant_id,
        amount=Decimal("0.05"),
        trace_id=trace_id,
        input_tokens=100,
        output_tokens=200,
        input_price=Decimal("0.0001"),
        output_price=Decimal("0.0002"),
    )
    
    assert transaction1.status == TransactionStatus.COMMITTED
    
    # 3. 第二次记录相同 trace_id 的交易（应该返回已有记录）
    transaction2 = await billing_repo.record_transaction(
        tenant_id=tenant_id,
        amount=Decimal("0.05"),
        trace_id=trace_id,
        input_tokens=100,
        output_tokens=200,
        input_price=Decimal("0.0001"),
        output_price=Decimal("0.0002"),
    )
    
    # 应该返回相同的交易记录
    assert transaction2.id == transaction1.id
    assert transaction2.status == TransactionStatus.COMMITTED
    
    # 4. 验证只有一条交易记录
    stmt = select(BillingTransaction).where(BillingTransaction.trace_id == trace_id)
    result = await db_session.execute(stmt)
    transactions = result.scalars().all()
    
    assert len(transactions) == 1
