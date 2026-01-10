"""
Celery Beat 定时任务配置

配置周期性同步任务：
- 配额同步（Redis → DB）
- API Key 预算同步（Redis → DB）
"""

from celery.schedules import crontab

# Celery Beat 定时任务配置
beat_schedule = {
    # 每 5 分钟同步一次配额
    "sync-all-quotas": {
        "task": "quota_sync.sync_all_quotas",
        "schedule": 300.0,  # 5 分钟
        "options": {
            "expires": 240,  # 4 分钟过期
        },
    },
    
    # 每 10 分钟同步一次 API Key 预算
    "sync-all-apikey-budgets": {
        "task": "apikey_sync.sync_all_apikey_budgets",
        "schedule": 600.0,  # 10 分钟
        "options": {
            "expires": 540,  # 9 分钟过期
        },
    },
    
    # 每小时同步一次（更完整的同步，包括审计）
    "sync-all-quotas-hourly": {
        "task": "quota_sync.sync_all_quotas",
        "schedule": crontab(minute=0),  # 每小时整点
        "options": {
            "expires": 3300,  # 55 分钟过期
        },
    },
}

# Celery 配置
celery_config = {
    "beat_schedule": beat_schedule,
    "timezone": "UTC",
    "enable_utc": True,
}
