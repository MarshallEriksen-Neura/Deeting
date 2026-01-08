
import asyncio
import hashlib
import hmac
import os
import sys
import uuid
from decimal import Decimal

# 将 backend 目录添加到 sys.path
sys.path.append(os.path.join(os.getcwd(), "backend"))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine


# 尝试从环境变量或 .env 读取数据库配置
def get_db_url():
    # 简单的 .env 解析
    env_vars = {}
    if os.path.exists(".env"):
        with open(".env") as f:
            for line in f:
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.strip().split("=", 1)
                    env_vars[k] = v

    user = env_vars.get("POSTGRES_USER", "apiproxy")
    password = env_vars.get("POSTGRES_PASSWORD", "timeline-postgres-2025")
    host = env_vars.get("POSTGRES_HOST", "192.168.31.145")
    port = "25432" # 从 .env 看到是 25432
    db = env_vars.get("POSTGRES_DB", "apiproxy")

    return f"postgresql+asyncpg://{user}:{password}@{host}:{port}/{db}"

async def init_test_env():
    db_url = get_db_url()
    print(f"Connecting to: {db_url}")

    engine = create_async_engine(db_url)
    AsyncSessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    async with AsyncSessionLocal() as session:
        try:
            # 1. 检查或创建超级用户
            from app.models.user import User
            result = await session.execute(select(User).limit(1))
            admin = result.scalars().first()

            if not admin:
                print("Creating default admin user...")
                from app.utils.security import get_password_hash
                admin = User(
                    id=uuid.uuid4(),
                    email="admin@example.com",
                    username="admin",
                    hashed_password=get_password_hash("admin123"),
                    is_active=True,
                    is_superuser=True
                )
                session.add(admin)
                await session.flush()

            print(f"Admin user: {admin.email} (ID: {admin.id})")

            # 2. 创建测试租户和配额
            tenant_id = uuid.uuid4()
            from app.models.billing import TenantQuota
            quota = TenantQuota(
                tenant_id=tenant_id,
                balance=Decimal("10000.00"),
                daily_quota=1000000,
                monthly_quota=10000000,
                rpm_limit=10000,
                tpm_limit=1000000,
            )
            session.add(quota)
            print(f"Created TenantQuota for tenant: {tenant_id}")

            # 3. 创建 API Key
            from app.core.config import settings
            from app.models.api_key import ApiKey, ApiKeyStatus, ApiKeyType

            # 手动生成 key 和 secret 以便输出
            # 逻辑参考 ApiKeyService
            alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
            raw_key = "sk-ext-" + "".join(uuid.uuid4().hex for _ in range(2))[:48]
            raw_secret = "".join(uuid.uuid4().hex for _ in range(2))[:48]

            app_secret_key = settings.JWT_SECRET_KEY or "dev-secret"

            def compute_hash(val):
                return hmac.new(
                    app_secret_key.encode(),
                    val.encode(),
                    hashlib.sha256
                ).hexdigest()

            key_hash = compute_hash(raw_key)
            secret_hash = compute_hash(raw_secret)

            api_key = ApiKey(
                id=uuid.uuid4(),
                key_prefix=raw_key[:7],
                key_hash=key_hash,
                key_hint=raw_key[-4:],
                secret_hash=secret_hash,
                secret_hint=raw_secret[-4:],
                type=ApiKeyType.EXTERNAL,
                status=ApiKeyStatus.ACTIVE,
                name="Performance Test Key",
                tenant_id=tenant_id,
                created_by=admin.id,
            )
            session.add(api_key)

            await session.commit()

            print("\n" + "="*60)
            print("PERFORMANCE TEST ENVIRONMENT INITIALIZED")
            print("="*60)
            print(f"API Key:    {raw_key}")
            print(f"API Secret: {raw_secret}")
            print(f"Tenant ID:  {tenant_id}")
            print("="*60)
            print("Use these credentials in your Locust scripts.")
            print("="*60 + "\n")

        except Exception as e:
            print(f"Error: {e}")
            await session.rollback()
            raise

if __name__ == "__main__":
    asyncio.run(init_test_env())
