# 从零开始的最优计费与配额方案 (Part 3)

## 💻 核心代码实现 (续)

### 4. 流式计费回调 (API 层)

```python
# backend/app/api/v1/external/gateway.py

async def _stream_billing_callback(
    ctx: WorkflowContext,
    accumulator: StreamTokenAccumulator,
) -> None:
    """
    流式计费回调：提交 PENDING 交易
    
    新逻辑：
    1. 从 Context 获取 pending_trace_id
    2. 使用 tiktoken 精确计算 output tokens
    3. 调用 BillingRepository.commit_pending_transaction()
    4. 记录用量（通过 Celery 任务）
    """
    # 检查是否有 PENDING 交易
    pending_trace_id = ctx.get("billing", "pending_trace_id")
    if not pending_trace_id:
        logger.warning(f"No pending transaction for stream trace_id={ctx.trace_id}")
        return
    
    # 获取定价配置
    pricing = ctx.get("billing", "pricing_config") or {}
    if not pricing:
        logger.info(f"No pricing config, skip billing trace_id={ctx.trace_id}")
        return
    
    # 使用增强的 token 计算（优先级：usage > tiktoken > 估算）
    output_tokens = accumulator.calculate_output_tokens(ctx.requested_model)
    
    # 更新 Context 中的 billing 信息
    ctx.billing.input_tokens = accumulator.input_tokens
    ctx.billing.output_tokens = output_tokens
    
    # 提交 PENDING 交易
    if ctx.db_session:
        try:
            repo = BillingRepository(ctx.db_session)
            transaction = await repo.commit_pending_transaction(
                trace_id=pending_trace_id,
                input_tokens=accumulator.input_tokens,
                output_tokens=output_tokens,
                input_price=Decimal(str(pricing.get("input_per_1k", 0))),
                output_price=Decimal(str(pricing.get("output_per_1k", 0))),
                allow_negative=True,  # 流式允许负值
            )
            
            # 更新 Context
            ctx.billing.total_cost = float(transaction.amount)
            ctx.billing.currency = pricing.get("currency", "USD")
            
            # 记录计算方式（用于监控）
            calculation_method = "usage" if accumulator._has_usage else (
                "tiktoken" if accumulator._collected_text else "estimated"
            )
            
            logger.info(
                f"Stream billing committed trace_id={ctx.trace_id} "
                f"method={calculation_method} "
                f"tokens={ctx.billing.total_tokens} "
                f"cost={transaction.amount:.6f}"
            )
            
            # 监控指标
            from app.core.monitoring import metrics
            metrics.counter(
                "stream.token_calculation",
                tags={"method": calculation_method}
            )
            
        except Exception as e:
            logger.error(f"Stream billing commit failed trace_id={ctx.trace_id}: {e}")
            # 发送告警
            from app.core.monitoring import alert_billing_failure
            alert_billing_failure(ctx.trace_id, str(e))
    
    # 异步记录用量（通过 Celery）
    try:
        from app.tasks.billing import record_usage_task
        
        usage_data = {
            "tenant_id": str(ctx.tenant_id) if ctx.tenant_id else None,
            "api_key_id": str(ctx.api_key_id) if ctx.api_key_id else None,
            "trace_id": ctx.trace_id,
            "model": ctx.requested_model,
            "capability": ctx.capability,
            "input_tokens": accumulator.input_tokens,
            "output_tokens": output_tokens,
            "total_cost": ctx.billing.total_cost,
            "currency": ctx.billing.currency,
            "provider": ctx.upstream_result.provider,
            "latency_ms": ctx.upstream_result.latency_ms,
            "is_stream": True,
            "stream_completed": accumulator.is_completed,
            "stream_error": accumulator.error,
        }
        
        record_usage_task.delay(usage_data)
        
    except Exception as e:
        logger.warning(f"Usage task dispatch failed trace_id={ctx.trace_id}: {e}")
```


### 5. StreamTokenAccumulator 增强 (精确计算)

```python
# backend/app/services/workflow/steps/upstream_call.py

@dataclass
class StreamTokenAccumulator:
    """
    流式 Token 累计器（增强版）
    
    优先级：
    1. 上游返回的 usage 信息（最准确）
    2. tiktoken 精确计算（误差 < 1%）
    3. 基于 chunks 估算（兜底）
    """
    input_tokens: int = 0
    output_tokens: int = 0
    chunks_count: int = 0
    is_completed: bool = False
    error: str | None = None
    finish_reason: str | None = None
    model: str | None = None
    
    # 新增：收集的文本内容
    _collected_text: str = ""
    _has_usage: bool = False
    
    def parse_sse_chunk(self, chunk: bytes) -> None:
        """解析 SSE 块并累计 token"""
        try:
            text = chunk.decode("utf-8")
            for line in text.split("\n"):
                line = line.strip()
                if not line or line == "data: [DONE]":
                    if line == "data: [DONE]":
                        self.is_completed = True
                    continue
                
                if line.startswith("data: "):
                    json_str = line[6:]
                    try:
                        data = json.loads(json_str)
                        self.chunks_count += 1
                        
                        # 提取 model
                        if not self.model and "model" in data:
                            self.model = data["model"]
                        
                        # 提取 finish_reason
                        if data.get("choices"):
                            choice = data["choices"][0]
                            if choice.get("finish_reason"):
                                self.finish_reason = choice["finish_reason"]
                            
                            # 收集文本内容（用于 tiktoken 计算）
                            delta = choice.get("delta", {})
                            if "content" in delta:
                                self._collected_text += delta["content"]
                        
                        # 提取 usage（优先使用）
                        if "usage" in data:
                            usage = data["usage"]
                            self.input_tokens = usage.get("prompt_tokens", 0)
                            self.output_tokens = usage.get("completion_tokens", 0)
                            self._has_usage = True
                    
                    except json.JSONDecodeError:
                        pass
        except Exception as e:
            self.error = str(e)
    
    def calculate_output_tokens(self, model: str | None = None) -> int:
        """
        计算输出 tokens（优先级：usage > tiktoken > 估算）
        """
        # 1. 优先使用上游返回的 usage
        if self._has_usage and self.output_tokens > 0:
            return self.output_tokens
        
        # 2. 使用 tiktoken 精确计算
        if self._collected_text:
            try:
                import tiktoken
                
                # 根据模型选择编码器
                model_name = model or self.model or "gpt-3.5-turbo"
                if "gpt-4" in model_name:
                    encoding = tiktoken.encoding_for_model("gpt-4")
                elif "gpt-3.5" in model_name:
                    encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")
                elif "claude" in model_name:
                    encoding = tiktoken.get_encoding("cl100k_base")
                else:
                    encoding = tiktoken.get_encoding("cl100k_base")
                
                tokens = len(encoding.encode(self._collected_text))
                logger.debug(f"Calculated tokens using tiktoken: {tokens}")
                return tokens
                
            except Exception as e:
                logger.warning(f"tiktoken calculation failed: {e}")
        
        # 3. 最后使用估算
        estimated = max(1, self.chunks_count * 3)
        logger.warning(
            f"Using estimated tokens: {estimated} "
            f"(chunks={self.chunks_count}, no usage info)"
        )
        return estimated
```



---

## 🔧 配置文件

### 1. Redis Lua 脚本加载器

```python
# backend/app/core/cache.py

import os
from pathlib import Path
from typing import Dict

class Cache:
    def __init__(self):
        self._redis = None
        self._script_shas: Dict[str, str] = {}
    
    async def preload_scripts(self) -> None:
        """预加载 Lua 脚本"""
        if not self._redis:
            logger.warning("Redis not available, skip script preload")
            return
        
        scripts_dir = Path(__file__).parent / "redis_scripts"
        if not scripts_dir.exists():
            logger.warning(f"Scripts directory not found: {scripts_dir}")
            return
        
        # 加载所有 .lua 脚本
        for script_file in scripts_dir.glob("*.lua"):
            script_name = script_file.stem
            script_content = script_file.read_text()
            
            try:
                sha = await self._redis.script_load(script_content)
                self._script_shas[script_name] = sha
                logger.info(f"Loaded Lua script: {script_name} -> {sha}")
            except Exception as e:
                logger.error(f"Failed to load script {script_name}: {e}")
    
    def get_script_sha(self, script_name: str) -> str | None:
        """获取脚本 SHA"""
        return self._script_shas.get(script_name)

# 全局实例
cache = Cache()
```

### 2. 缓存键定义

```python
# backend/app/core/cache_keys.py

class CacheKeys:
    """缓存键定义"""
    
    @staticmethod
    def quota_hash(tenant_id: str) -> str:
        """租户配额 Hash"""
        return f"gw:quota:tenant:{tenant_id}"
    
    @staticmethod
    def billing_deduct_idempotency(tenant_id: str, trace_id: str) -> str:
        """计费幂等键"""
        return f"gw:billing:idempotent:{tenant_id}:{trace_id}"
    
    @staticmethod
    def rate_limit_rpm(tenant_id: str, minute: str) -> str:
        """RPM 限流键"""
        return f"gw:ratelimit:rpm:{tenant_id}:{minute}"
    
    @staticmethod
    def rate_limit_tpm(tenant_id: str, minute: str) -> str:
        """TPM 限流键"""
        return f"gw:ratelimit:tpm:{tenant_id}:{minute}"
    
    @staticmethod
    def session_lock(session_id: str) -> str:
        """会话锁"""
        return f"gw:lock:session:{session_id}"
```

### 3. 监控指标定义

```python
# backend/app/core/monitoring.py

from prometheus_client import Counter, Histogram, Gauge

# 配额检查
quota_check_passed = Counter(
    "quota_check_passed_total",
    "配额检查通过次数"
)

quota_check_failed = Counter(
    "quota_check_failed_total",
    "配额检查失败次数",
    ["reason"]  # balance, daily, monthly
)

quota_check_duration = Histogram(
    "quota_check_duration_seconds",
    "配额检查耗时"
)

# 计费
billing_deduct_success = Counter(
    "billing_deduct_success_total",
    "计费成功次数"
)

billing_deduct_failure = Counter(
    "billing_deduct_failure_total",
    "计费失败次数",
    ["reason"]  # insufficient_balance, redis_error, db_error
)

billing_duration = Histogram(
    "billing_duration_seconds",
    "计费耗时"
)

billing_idempotent_hit = Counter(
    "billing_idempotent_hit_total",
    "幂等键命中次数"
)

# 流式计费
stream_pending_created = Counter(
    "billing_stream_pending_created_total",
    "流式 PENDING 交易创建次数"
)

stream_committed = Counter(
    "billing_stream_committed_total",
    "流式交易提交次数"
)

stream_failed = Counter(
    "billing_stream_failed_total",
    "流式交易失败次数"
)

stream_token_calculation = Counter(
    "stream_token_calculation_total",
    "流式 token 计算方式",
    ["method"]  # usage, tiktoken, estimated
)

stream_token_accuracy = Histogram(
    "stream_token_accuracy_percent",
    "流式 token 计算准确率"
)

# Redis 与 DB 一致性
quota_redis_db_diff = Gauge(
    "quota_redis_db_diff",
    "Redis 与 DB 配额差异",
    ["tenant_id"]
)

# Redis Lua 脚本
redis_lua_duration = Histogram(
    "redis_lua_duration_seconds",
    "Redis Lua 脚本耗时",
    ["script"]  # quota_check, quota_deduct
)
```



---

## 🧪 测试用例

### 1. QuotaCheckStep 单元测试

```python
# backend/tests/test_quota_check.py

import pytest
from decimal import Decimal
from app.services.workflow.steps.quota_check import QuotaCheckStep, QuotaExceededError
from app.services.orchestrator.context import WorkflowContext, Channel

@pytest.mark.asyncio
async def test_quota_check_pass(db_session, redis_client):
    """测试配额检查通过"""
    # 准备数据
    tenant_id = "test-tenant-123"
    quota = await create_test_quota(
        db_session,
        tenant_id=tenant_id,
        balance=Decimal("100.00"),
        daily_quota=1000,
        daily_used=0,
        monthly_quota=30000,
        monthly_used=0,
    )
    
    # 创建上下文
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        capability="chat",
        requested_model="gpt-3.5-turbo",
        db_session=db_session,
        tenant_id=tenant_id,
    )
    
    # 执行检查
    step = QuotaCheckStep()
    result = await step.execute(ctx)
    
    # 验证结果
    assert result.status == StepStatus.SUCCESS
    assert ctx.get("quota_check", "remaining_balance") == 100.00
    assert ctx.get("quota_check", "daily_remaining") == 1000
    assert ctx.get("quota_check", "monthly_remaining") == 30000


@pytest.mark.asyncio
async def test_quota_check_insufficient_balance(db_session, redis_client):
    """测试余额不足"""
    # 准备数据
    tenant_id = "test-tenant-123"
    quota = await create_test_quota(
        db_session,
        tenant_id=tenant_id,
        balance=Decimal("0.01"),  # 余额不足
        daily_quota=1000,
        daily_used=0,
    )
    
    # 创建上下文
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        capability="chat",
        requested_model="gpt-3.5-turbo",
        db_session=db_session,
        tenant_id=tenant_id,
    )
    
    # 设置定价（估算费用会超过余额）
    ctx.set("routing", "pricing_config", {
        "input_per_1k": 0.001,
        "output_per_1k": 0.002,
    })
    
    # 执行检查
    step = QuotaCheckStep()
    result = await step.execute(ctx)
    
    # 验证结果
    assert result.status == StepStatus.FAILED
    assert ctx.error_code == "QUOTA_BALANCE_EXCEEDED"


@pytest.mark.asyncio
async def test_quota_check_daily_exceeded(db_session, redis_client):
    """测试日配额超限"""
    # 准备数据
    tenant_id = "test-tenant-123"
    quota = await create_test_quota(
        db_session,
        tenant_id=tenant_id,
        balance=Decimal("100.00"),
        daily_quota=1000,
        daily_used=1000,  # 日配额已用完
    )
    
    # 创建上下文
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        capability="chat",
        requested_model="gpt-3.5-turbo",
        db_session=db_session,
        tenant_id=tenant_id,
    )
    
    # 执行检查
    step = QuotaCheckStep()
    result = await step.execute(ctx)
    
    # 验证结果
    assert result.status == StepStatus.FAILED
    assert ctx.error_code == "QUOTA_DAILY_EXCEEDED"
```

### 2. BillingStep 单元测试

```python
# backend/tests/test_billing.py

import pytest
from decimal import Decimal
from app.services.workflow.steps.billing import BillingStep
from app.services.orchestrator.context import WorkflowContext, Channel

@pytest.mark.asyncio
async def test_billing_non_stream(db_session, redis_client):
    """测试非流式计费"""
    # 准备数据
    tenant_id = "test-tenant-123"
    quota = await create_test_quota(
        db_session,
        tenant_id=tenant_id,
        balance=Decimal("100.00"),
    )
    
    # 创建上下文
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        capability="chat",
        requested_model="gpt-3.5-turbo",
        db_session=db_session,
        tenant_id=tenant_id,
        trace_id="test-trace-123",
    )
    
    # 设置 token 用量
    ctx.billing.input_tokens = 100
    ctx.billing.output_tokens = 200
    
    # 设置定价
    ctx.set("routing", "pricing_config", {
        "input_per_1k": 0.001,
        "output_per_1k": 0.002,
        "currency": "USD",
    })
    
    # 执行计费
    step = BillingStep()
    result = await step.execute(ctx)
    
    # 验证结果
    assert result.status == StepStatus.SUCCESS
    assert ctx.billing.total_cost == 0.0005  # (100/1000)*0.001 + (200/1000)*0.002
    
    # 验证交易记录
    transaction = await billing_repo.get_by_trace_id("test-trace-123")
    assert transaction.status == TransactionStatus.COMMITTED
    assert transaction.amount == Decimal("0.0005")
    
    # 验证配额
    quota = await quota_repo.get_or_create(tenant_id)
    assert quota.balance == Decimal("99.9995")
    assert quota.daily_used == 1
    assert quota.monthly_used == 1


@pytest.mark.asyncio
async def test_billing_stream_pending(db_session, redis_client):
    """测试流式计费（创建 PENDING 交易）"""
    # 准备数据
    tenant_id = "test-tenant-123"
    quota = await create_test_quota(
        db_session,
        tenant_id=tenant_id,
        balance=Decimal("100.00"),
    )
    
    # 创建上下文
    ctx = WorkflowContext(
        channel=Channel.EXTERNAL,
        capability="chat",
        requested_model="gpt-3.5-turbo",
        db_session=db_session,
        tenant_id=tenant_id,
        trace_id="test-trace-123",
    )
    
    # 设置流式标志
    ctx.set("upstream_call", "stream", True)
    
    # 设置定价
    ctx.set("routing", "pricing_config", {
        "input_per_1k": 0.001,
        "output_per_1k": 0.002,
        "currency": "USD",
    })
    
    # 执行计费
    step = BillingStep()
    result = await step.execute(ctx)
    
    # 验证结果
    assert result.status == StepStatus.SUCCESS
    assert ctx.get("billing", "pending_transaction_id") is not None
    
    # 验证交易记录
    transaction = await billing_repo.get_by_trace_id("test-trace-123")
    assert transaction.status == TransactionStatus.PENDING
    
    # 验证配额未扣减
    quota = await quota_repo.get_or_create(tenant_id)
    assert quota.balance == Decimal("100.00")
    assert quota.daily_used == 0
    assert quota.monthly_used == 0
```

### 3. BillingRepository 单元测试

```python
# backend/tests/test_billing_repository.py

import pytest
from decimal import Decimal
from app.repositories.billing_repository import (
    BillingRepository,
    InsufficientBalanceError,
    DuplicateTransactionError,
)

@pytest.mark.asyncio
async def test_deduct_success(db_session, redis_client):
    """测试扣费成功"""
    # 准备数据
    tenant_id = "test-tenant-123"
    quota = await create_test_quota(
        db_session,
        tenant_id=tenant_id,
        balance=Decimal("100.00"),
    )
    
    # 执行扣费
    repo = BillingRepository(db_session)
    transaction = await repo.deduct(
        tenant_id=tenant_id,
        amount=Decimal("0.50"),
        trace_id="test-trace-123",
        input_tokens=100,
        output_tokens=200,
        input_price=Decimal("0.001"),
        output_price=Decimal("0.002"),
    )
    
    # 验证交易
    assert transaction.status == TransactionStatus.COMMITTED
    assert transaction.amount == Decimal("0.50")
    assert transaction.balance_after == Decimal("99.50")
    
    # 验证配额
    quota = await quota_repo.get_or_create(tenant_id)
    assert quota.balance == Decimal("99.50")
    assert quota.daily_used == 1
    assert quota.monthly_used == 1


@pytest.mark.asyncio
async def test_deduct_idempotency(db_session, redis_client):
    """测试幂等性"""
    # 准备数据
    tenant_id = "test-tenant-123"
    quota = await create_test_quota(
        db_session,
        tenant_id=tenant_id,
        balance=Decimal("100.00"),
    )
    
    repo = BillingRepository(db_session)
    
    # 第一次扣费
    transaction1 = await repo.deduct(
        tenant_id=tenant_id,
        amount=Decimal("0.50"),
        trace_id="test-trace-123",
    )
    
    # 第二次扣费（相同 trace_id）
    transaction2 = await repo.deduct(
        tenant_id=tenant_id,
        amount=Decimal("0.50"),
        trace_id="test-trace-123",
    )
    
    # 验证返回相同交易
    assert transaction1.id == transaction2.id
    
    # 验证配额只扣减一次
    quota = await quota_repo.get_or_create(tenant_id)
    assert quota.balance == Decimal("99.50")
    assert quota.daily_used == 1
    assert quota.monthly_used == 1


@pytest.mark.asyncio
async def test_commit_pending_transaction(db_session, redis_client):
    """测试提交 PENDING 交易"""
    # 准备数据
    tenant_id = "test-tenant-123"
    quota = await create_test_quota(
        db_session,
        tenant_id=tenant_id,
        balance=Decimal("100.00"),
    )
    
    repo = BillingRepository(db_session)
    
    # 创建 PENDING 交易
    pending_tx = await repo.create_pending_transaction(
        tenant_id=tenant_id,
        trace_id="test-trace-123",
        estimated_tokens=1000,
        pricing={"input_per_1k": 0.001, "output_per_1k": 0.002},
    )
    
    assert pending_tx.status == TransactionStatus.PENDING
    
    # 提交交易
    committed_tx = await repo.commit_pending_transaction(
        trace_id="test-trace-123",
        input_tokens=100,
        output_tokens=200,
        input_price=Decimal("0.001"),
        output_price=Decimal("0.002"),
    )
    
    # 验证交易
    assert committed_tx.id == pending_tx.id
    assert committed_tx.status == TransactionStatus.COMMITTED
    assert committed_tx.input_tokens == 100
    assert committed_tx.output_tokens == 200
    
    # 验证配额
    quota = await quota_repo.get_or_create(tenant_id)
    assert quota.balance < Decimal("100.00")
    assert quota.daily_used == 1
    assert quota.monthly_used == 1
```



---

## 🚀 部署与运维

### 1. 数据库迁移脚本

```python
# backend/migrations/versions/xxx_add_optimal_billing_schema.py

"""Add optimal billing schema

Revision ID: xxx
Revises: yyy
Create Date: 2026-01-10 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'xxx'
down_revision = 'yyy'
branch_labels = None
depends_on = None


def upgrade():
    # 1. 创建 tenant_quota 表
    op.create_table(
        'tenant_quota',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column('balance', sa.DECIMAL(20, 6), nullable=False, server_default='0'),
        sa.Column('credit_limit', sa.DECIMAL(20, 6), nullable=False, server_default='0'),
        sa.Column('daily_quota', sa.Integer, nullable=False, server_default='1000'),
        sa.Column('daily_used', sa.Integer, nullable=False, server_default='0'),
        sa.Column('daily_reset_at', sa.Date, nullable=False),
        sa.Column('monthly_quota', sa.Integer, nullable=False, server_default='30000'),
        sa.Column('monthly_used', sa.Integer, nullable=False, server_default='0'),
        sa.Column('monthly_reset_at', sa.Date, nullable=False),
        sa.Column('rpm_limit', sa.Integer, nullable=True),
        sa.Column('tpm_limit', sa.Integer, nullable=True),
        sa.Column('created_at', sa.TIMESTAMP, nullable=False, server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.TIMESTAMP, nullable=False, server_default=sa.text('NOW()')),
        sa.Column('version', sa.Integer, nullable=False, server_default='1'),
    )
    
    op.create_index('idx_tenant_quota_tenant_id', 'tenant_quota', ['tenant_id'])
    op.create_index('idx_tenant_quota_daily_reset', 'tenant_quota', ['daily_reset_at'])
    op.create_index('idx_tenant_quota_monthly_reset', 'tenant_quota', ['monthly_reset_at'])
    
    # 2. 创建 billing_transaction 表
    op.create_table(
        'billing_transaction',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('api_key_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('trace_id', sa.String(255), nullable=False, unique=True),
        sa.Column('type', sa.String(50), nullable=False),
        sa.Column('status', sa.String(50), nullable=False),
        sa.Column('amount', sa.DECIMAL(20, 6), nullable=False),
        sa.Column('currency', sa.String(10), nullable=False, server_default='USD'),
        sa.Column('input_tokens', sa.Integer, nullable=False, server_default='0'),
        sa.Column('output_tokens', sa.Integer, nullable=False, server_default='0'),
        sa.Column('input_price', sa.DECIMAL(20, 6), nullable=True),
        sa.Column('output_price', sa.DECIMAL(20, 6), nullable=True),
        sa.Column('balance_before', sa.DECIMAL(20, 6), nullable=True),
        sa.Column('balance_after', sa.DECIMAL(20, 6), nullable=True),
        sa.Column('provider', sa.String(100), nullable=True),
        sa.Column('model', sa.String(255), nullable=True),
        sa.Column('preset_item_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('reversed_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('description', sa.Text, nullable=True),
        sa.Column('created_at', sa.TIMESTAMP, nullable=False, server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.TIMESTAMP, nullable=False, server_default=sa.text('NOW()')),
    )
    
    op.create_index('idx_billing_tenant_id', 'billing_transaction', ['tenant_id'])
    op.create_index('idx_billing_trace_id', 'billing_transaction', ['trace_id'])
    op.create_index('idx_billing_api_key_id', 'billing_transaction', ['api_key_id'])
    op.create_index('idx_billing_status', 'billing_transaction', ['status'])
    op.create_index('idx_billing_created_at', 'billing_transaction', ['created_at'])
    op.create_index('idx_billing_tenant_created', 'billing_transaction', ['tenant_id', 'created_at'])
    
    # 3. 创建 api_key_quota 表
    op.create_table(
        'api_key_quota',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('api_key_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('quota_type', sa.String(50), nullable=False),
        sa.Column('total_quota', sa.BigInteger, nullable=False),
        sa.Column('used_quota', sa.BigInteger, nullable=False, server_default='0'),
        sa.Column('reset_period', sa.String(50), nullable=True),
        sa.Column('reset_at', sa.TIMESTAMP, nullable=True),
        sa.Column('created_at', sa.TIMESTAMP, nullable=False, server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.TIMESTAMP, nullable=False, server_default=sa.text('NOW()')),
    )
    
    op.create_unique_constraint('uq_api_key_quota_key_type', 'api_key_quota', ['api_key_id', 'quota_type'])
    op.create_index('idx_api_key_quota_key_id', 'api_key_quota', ['api_key_id'])
    op.create_index('idx_api_key_quota_reset_at', 'api_key_quota', ['reset_at'])


def downgrade():
    op.drop_table('api_key_quota')
    op.drop_table('billing_transaction')
    op.drop_table('tenant_quota')
```

### 2. Redis Lua 脚本文件

创建目录和脚本文件：

```bash
mkdir -p backend/app/core/redis_scripts
```

**quota_check.lua**:
```lua
-- 见主文档中的完整脚本
```

**quota_deduct.lua**:
```lua
-- 见主文档中的完整脚本
```

### 3. 环境变量配置

```bash
# backend/.env

# Redis 配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0
REDIS_PASSWORD=

# 数据库配置
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/apiproxy

# 计费配置
BILLING_BLOCK_ON_INSUFFICIENT=true  # 余额不足时是否阻塞请求
BILLING_ALLOW_NEGATIVE=false  # 是否允许负余额（非流式）
BILLING_STREAM_ALLOW_NEGATIVE=true  # 是否允许负余额（流式）

# 监控配置
PROMETHEUS_ENABLED=true
PROMETHEUS_PORT=9090
```

### 4. 启动脚本

```bash
#!/bin/bash
# backend/scripts/start.sh

set -e

echo "Starting API Gateway..."

# 1. 检查环境变量
if [ ! -f .env ]; then
    echo "Error: .env file not found"
    exit 1
fi

# 2. 加载环境变量
source .env

# 3. 检查 Redis 连接
echo "Checking Redis connection..."
redis-cli -h $REDIS_HOST -p $REDIS_PORT ping || {
    echo "Error: Redis not available"
    exit 1
}

# 4. 检查数据库连接
echo "Checking database connection..."
psql $DATABASE_URL -c "SELECT 1" || {
    echo "Error: Database not available"
    exit 1
}

# 5. 运行数据库迁移
echo "Running database migrations..."
alembic upgrade head

# 6. 预加载 Redis Lua 脚本
echo "Preloading Redis Lua scripts..."
python -c "
from app.core.cache import cache
import asyncio
asyncio.run(cache.preload_scripts())
"

# 7. 启动应用
echo "Starting application..."
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

### 5. 健康检查端点

```python
# backend/app/api/health.py

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.cache import cache

router = APIRouter(tags=["Health"])

@router.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    """健康检查"""
    checks = {
        "status": "healthy",
        "database": "unknown",
        "redis": "unknown",
        "lua_scripts": "unknown",
    }
    
    # 检查数据库
    try:
        await db.execute("SELECT 1")
        checks["database"] = "healthy"
    except Exception as e:
        checks["database"] = f"unhealthy: {e}"
        checks["status"] = "unhealthy"
    
    # 检查 Redis
    try:
        redis_client = getattr(cache, "_redis", None)
        if redis_client:
            await redis_client.ping()
            checks["redis"] = "healthy"
        else:
            checks["redis"] = "not configured"
    except Exception as e:
        checks["redis"] = f"unhealthy: {e}"
        checks["status"] = "degraded"
    
    # 检查 Lua 脚本
    try:
        script_shas = cache._script_shas
        if "quota_check" in script_shas and "quota_deduct" in script_shas:
            checks["lua_scripts"] = "loaded"
        else:
            checks["lua_scripts"] = "not loaded"
            checks["status"] = "degraded"
    except Exception as e:
        checks["lua_scripts"] = f"error: {e}"
    
    return checks


@router.get("/health/ready")
async def readiness_check(db: AsyncSession = Depends(get_db)):
    """就绪检查（用于 K8s）"""
    try:
        await db.execute("SELECT 1")
        redis_client = getattr(cache, "_redis", None)
        if redis_client:
            await redis_client.ping()
        return {"status": "ready"}
    except Exception as e:
        return {"status": "not ready", "error": str(e)}, 503


@router.get("/health/live")
async def liveness_check():
    """存活检查（用于 K8s）"""
    return {"status": "alive"}
```

---

## 📊 监控与告警

### 1. Grafana Dashboard 配置

```json
{
  "dashboard": {
    "title": "API Gateway - Billing & Quota",
    "panels": [
      {
        "title": "配额检查成功率",
        "targets": [
          {
            "expr": "rate(quota_check_passed_total[5m]) / (rate(quota_check_passed_total[5m]) + rate(quota_check_failed_total[5m]))"
          }
        ]
      },
      {
        "title": "计费成功率",
        "targets": [
          {
            "expr": "rate(billing_deduct_success_total[5m]) / (rate(billing_deduct_success_total[5m]) + rate(billing_deduct_failure_total[5m]))"
          }
        ]
      },
      {
        "title": "流式 Token 计算方式分布",
        "targets": [
          {
            "expr": "sum by (method) (rate(stream_token_calculation_total[5m]))"
          }
        ]
      },
      {
        "title": "Redis 与 DB 配额差异",
        "targets": [
          {
            "expr": "quota_redis_db_diff"
          }
        ]
      },
      {
        "title": "计费 P99 延迟",
        "targets": [
          {
            "expr": "histogram_quantile(0.99, rate(billing_duration_seconds_bucket[5m]))"
          }
        ]
      }
    ]
  }
}
```

### 2. AlertManager 告警规则

```yaml
# alertmanager/rules/billing.yml

groups:
  - name: billing
    interval: 30s
    rules:
      - alert: QuotaCheckFailureRateHigh
        expr: rate(quota_check_failed_total[5m]) > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "配额检查失败率过高"
          description: "配额检查失败率超过 5%"
      
      - alert: BillingFailureRateHigh
        expr: rate(billing_deduct_failure_total[5m]) > 0.01
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "计费失败率过高"
          description: "计费失败率超过 1%"
      
      - alert: QuotaRedisDbDiffHigh
        expr: quota_redis_db_diff > 0.01
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Redis 与 DB 配额差异过大"
          description: "Redis 与 DB 配额差异超过 0.01"
      
      - alert: StreamTokenAccuracyLow
        expr: histogram_quantile(0.50, rate(stream_token_accuracy_percent_bucket[10m])) < 0.99
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "流式 Token 计算准确率低"
          description: "流式 Token 计算准确率低于 99%"
      
      - alert: BillingLatencyHigh
        expr: histogram_quantile(0.99, rate(billing_duration_seconds_bucket[5m])) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "计费延迟过高"
          description: "计费 P99 延迟超过 100ms"
```

---

## ✅ 总结

Part 3 补充了以下内容：

1. ✅ **流式计费回调实现** - 提交 PENDING 交易，使用 tiktoken 精确计算
2. ✅ **StreamTokenAccumulator 增强** - 三级优先级计算（usage > tiktoken > 估算）
3. ✅ **配置文件** - Redis Lua 脚本加载器、缓存键定义、监控指标定义
4. ✅ **完整测试用例** - QuotaCheckStep、BillingStep、BillingRepository 单元测试
5. ✅ **部署与运维** - 数据库迁移脚本、启动脚本、健康检查端点
6. ✅ **监控与告警** - Grafana Dashboard、AlertManager 告警规则

现在三个文档已经完整，涵盖了从零开始实施最优方案的所有细节！
