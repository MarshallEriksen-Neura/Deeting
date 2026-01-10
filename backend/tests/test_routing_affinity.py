"""
路由亲和状态机测试

测试 RoutingAffinityStateMachine 的状态转换：
- INIT -> EXPLORING
- EXPLORING -> LOCKED
- LOCKED -> EXPLORING (失败后)
"""

import pytest

from app.services.routing.affinity import (
    AffinityState,
    RoutingAffinityStateMachine,
)


@pytest.mark.asyncio
async def test_affinity_initial_state():
    """测试初始状态"""
    machine = RoutingAffinityStateMachine(
        session_id="test_session_1",
        model="gpt-4",
        explore_threshold=3,
    )
    
    ctx = await machine.get_context()
    assert ctx.state == AffinityState.INIT


@pytest.mark.asyncio
async def test_affinity_exploring_to_locked():
    """测试从探索期到锁定期的转换"""
    machine = RoutingAffinityStateMachine(
        session_id="test_session_2",
        model="gpt-4",
        explore_threshold=3,
    )
    
    # 第一次请求：INIT -> EXPLORING
    await machine.record_request("openai", "item_1", success=True)
    ctx = await machine.get_context()
    assert ctx.state == AffinityState.EXPLORING
    assert ctx.explore_count == 1
    
    # 第二次请求：继续探索
    await machine.record_request("anthropic", "item_2", success=True)
    ctx = await machine.get_context()
    assert ctx.state == AffinityState.EXPLORING
    assert ctx.explore_count == 2
    
    # 第三次请求：达到阈值，锁定
    await machine.record_request("openai", "item_1", success=True)
    ctx = await machine.get_context()
    assert ctx.state == AffinityState.LOCKED
    assert ctx.locked_provider == "openai"
    assert ctx.locked_item_id == "item_1"


@pytest.mark.asyncio
async def test_affinity_locked_to_exploring_on_failure():
    """测试锁定期连续失败后重新探索"""
    machine = RoutingAffinityStateMachine(
        session_id="test_session_3",
        model="gpt-4",
        explore_threshold=2,
        failure_threshold=3,
    )
    
    # 快速进入锁定期
    await machine.record_request("openai", "item_1", success=True)
    await machine.record_request("openai", "item_1", success=True)
    
    ctx = await machine.get_context()
    assert ctx.state == AffinityState.LOCKED
    
    # 连续失败
    await machine.record_request("openai", "item_1", success=False)
    await machine.record_request("openai", "item_1", success=False)
    await machine.record_request("openai", "item_1", success=False)
    
    # 应该重新进入探索期
    ctx = await machine.get_context()
    assert ctx.state == AffinityState.EXPLORING


@pytest.mark.asyncio
async def test_affinity_should_use():
    """测试是否应该使用亲和路由"""
    machine = RoutingAffinityStateMachine(
        session_id="test_session_4",
        model="gpt-4",
        explore_threshold=2,
    )
    
    # 初始状态：不使用亲和
    should_use, provider, item_id = await machine.should_use_affinity()
    assert should_use is False
    
    # 进入锁定期
    await machine.record_request("openai", "item_1", success=True)
    await machine.record_request("openai", "item_1", success=True)
    
    # 锁定期：使用亲和
    should_use, provider, item_id = await machine.should_use_affinity()
    assert should_use is True
    assert provider == "openai"
    assert item_id == "item_1"


@pytest.mark.asyncio
async def test_affinity_reset():
    """测试重置状态机"""
    machine = RoutingAffinityStateMachine(
        session_id="test_session_5",
        model="gpt-4",
        explore_threshold=2,
    )
    
    # 进入锁定期
    await machine.record_request("openai", "item_1", success=True)
    await machine.record_request("openai", "item_1", success=True)
    
    ctx = await machine.get_context()
    assert ctx.state == AffinityState.LOCKED
    
    # 重置
    await machine.reset()
    
    # 应该回到初始状态
    ctx = await machine.get_context()
    assert ctx.state == AffinityState.INIT
