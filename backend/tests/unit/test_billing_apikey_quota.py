from unittest.mock import ANY, MagicMock, patch
from uuid import uuid4

import pytest

from app.tasks.billing import record_usage_task


@pytest.fixture
def mock_db():
    db = MagicMock()
    return db

@pytest.fixture
def mock_get_sync_db(mock_db):
    with patch("app.tasks.billing.get_sync_db") as mock:
        def get_db_gen():
            yield mock_db
        mock.side_effect = get_db_gen
        yield mock

@pytest.fixture
def mock_redis_sync():
    with patch("redis.from_url") as mock:
        r = MagicMock()
        mock.return_value = r
        yield r

def test_record_usage_task_updates_quota(mock_get_sync_db, mock_db, mock_redis_sync):
    """测试异步计费任务更新 API Key 配额"""
    api_key_id = uuid4()
    usage_data = {
        "api_key_id": str(api_key_id),
        "input_tokens": 100,
        "output_tokens": 50,
        "total_cost": 0.0015,
        "is_error": False
    }

    mock_redis_sync.exists.return_value = True

    # 执行任务
    record_usage_task(usage_data)

    # 1. 验证 ApiKeyUsage Upsert + Quota Updates
    assert mock_db.execute.call_count >= 3

    # 验证 Redis 更新
    mock_redis_sync.pipeline.assert_called()
    pipe = mock_redis_sync.pipeline.return_value
    pipe.hincrby.assert_called_with(ANY, "token:used", 150)
    pipe.hincrbyfloat.assert_called_with(ANY, "cost:used", 0.0015)
    pipe.execute.assert_called_once()
