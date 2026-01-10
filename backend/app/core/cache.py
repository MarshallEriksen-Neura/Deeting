import asyncio
import functools
import pickle
import random
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, TypeVar

from redis.asyncio import Redis, from_url

from app.core.config import settings
from app.core.logging import logger

T = TypeVar("T")

class CacheService:
    """
    Redis 缓存服务
    """
    def __init__(self):
        self._redis: Redis | None = None
        self._script_sha: dict[str, str] = {}

    def init(self) -> None:
        """初始化 Redis 连接池"""
        if settings.REDIS_URL:
            self._redis = from_url(
                settings.REDIS_URL,
                encoding=settings.REDIS_ENCODING,
                decode_responses=False # 我们手动处理序列化，支持对象缓存
            )
            logger.info(f"Redis initialized at {settings.REDIS_URL}")
        else:
            logger.warning("REDIS_URL not set, cache will be disabled")

    async def preload_scripts(self) -> None:
        """
        预加载 Redis Lua 脚本，存储 SHA 以供 evalsha 调用

        - 在应用启动时调用
        - 加载失败时写入日志并保留空字典，后续调用将自动降级为 Python 实现
        """
        if not self._redis:
            logger.warning("Skip preload_scripts: redis not initialized")
            return

        scripts_dir = Path(__file__).parent / "redis_scripts"
        script_map = {
            "sliding_window_rate_limit": scripts_dir / "sliding_window_rate_limit.lua",
            "token_bucket_rate_limit": scripts_dir / "token_bucket_rate_limit.lua",
            "quota_check": scripts_dir / "quota_check.lua",
            "quota_deduct": scripts_dir / "quota_deduct.lua",
            "apikey_quota_check": scripts_dir / "apikey_quota_check.lua",
            "apikey_budget_deduct": scripts_dir / "apikey_budget_deduct.lua",
        }

        for name, path in script_map.items():
            try:
                content = path.read_text(encoding="utf-8")
                sha = await self._redis.script_load(content)
                self._script_sha[name] = sha
                logger.info(f"Redis script loaded name={name} sha={sha}")
            except FileNotFoundError:
                logger.warning(f"Redis script file missing: {path}")
            except Exception as exc:
                logger.warning(f"Redis script load failed name={name}: {exc}")

    def register_script_sha(self, name: str, sha: str | None) -> None:
        """允许手动写入脚本 SHA（便于测试注入或懒加载回写）"""
        if sha:
            self._script_sha[name] = sha

    async def close(self) -> None:
        """关闭 Redis 连接"""
        if self._redis:
            await self._redis.close()
            logger.info("Redis connection closed")

    @property
    def redis(self) -> Redis:
        if not self._redis:
            raise RuntimeError("CacheService not initialized. Call init() first.")
        return self._redis

    def _make_key(self, key: str) -> str:
        return f"{settings.CACHE_PREFIX}{key}"

    async def get(self, key: str) -> Any | None:
        """获取缓存值 (自动反序列化)"""
        if not self._redis: return None
        try:
            data = await self._redis.get(self._make_key(key))
            if data:
                return pickle.loads(data)
        except Exception as e:
            logger.error(f"Cache get error for key {key}: {e}")
        return None

    async def set(
        self,
        key: str,
        value: Any,
        ttl: int | None = settings.CACHE_DEFAULT_TTL,
        ex: int | None = None,
        nx: bool | None = None,
    ) -> bool:
        """设置缓存值 (自动序列化)

        支持 NX 语义，便于幂等键/短锁场景。
        """
        if not self._redis: return False
        try:
            data = pickle.dumps(value)
            expire = ex if ex is not None else ttl
            kwargs = {"ex": expire}
            if nx is not None:
                kwargs["nx"] = nx
            return await self._redis.set(self._make_key(key), data, **kwargs)
        except Exception as e:
            logger.error(f"Cache set error for key {key}: {e}")
            return False

    async def delete(self, key: str) -> bool:
        """删除缓存"""
        if not self._redis: return False
        try:
            await self._redis.delete(self._make_key(key))
            return True
        except Exception as e:
            logger.error(f"Cache delete error for key {key}: {e}")
            return False

    async def incr(self, key: str, ttl: int | None = None, amount: int = 1) -> int:
        """原子自增计数，首次创建时可设置过期时间"""
        if not self._redis:
            return 0
        try:
            full_key = self._make_key(key)
            val = await self._redis.incr(full_key, amount)
            if ttl and val == 1:
                # 仅在第一次创建时设置过期，避免覆盖外部主动设置的 TTL
                await self._redis.expire(full_key, ttl)
            return int(val)
        except Exception as e:
            logger.error(f"Cache incr error for key {key}: {e}")
            return 0

    async def clear_prefix(self, prefix: str) -> int:
        """根据前缀清除缓存"""
        if not self._redis: return 0
        try:
            # 这里的 prefix 不需要包含 settings.CACHE_PREFIX，因为 _make_key 会加
            # 但 keys 搜索需要完整的 pattern
            pattern = f"{settings.CACHE_PREFIX}{prefix}*"
            keys = await self._redis.keys(pattern)
            if keys:
                return await self._redis.delete(*keys)
            return 0
        except Exception as e:
            logger.error(f"Cache clear_prefix error for {prefix}: {e}")
            return 0

    def cached(
        self,
        prefix: str,
        ttl: int = settings.CACHE_DEFAULT_TTL,
        key_builder: Callable[..., str] | None = None
    ):
        """
        装饰器：缓存异步函数的返回值
        :param prefix: 缓存键前缀
        :param ttl: 过期时间 (秒)
        :param key_builder: 自定义键生成函数 (func_args, func_kwargs) -> str
        """
        def decorator(func: Callable[..., Any]):
            @functools.wraps(func)
            async def wrapper(*args, **kwargs):
                if not self._redis:
                    return await func(*args, **kwargs)

                # 生成缓存 Key
                if key_builder:
                    cache_key_suffix = key_builder(*args, **kwargs)
                else:
                    # 默认策略：拼接所有参数
                    # 注意：args[0] 如果是 self/cls，可能导致 key 过长或无法序列化
                    # 简单的处理：过滤掉 self/cls (通常是第一个参数且是 class/object 实例)
                    safe_args = args
                    if args and hasattr(args[0], '__dict__'):
                         # 这是一个简单的 heuristic，可能不完全准确
                         # 更好的方式是明确指定 key_builder
                         # 或者仅使用 kwargs
                         pass

                    # 简单序列化参数做 key (MD5 或直接拼接)
                    # 这里为了演示，简单拼接 key + 参数哈希
                    arg_str = str(args) + str(kwargs)
                    import hashlib
                    arg_hash = hashlib.md5(arg_str.encode()).hexdigest()
                    cache_key_suffix = f"{func.__name__}:{arg_hash}"

                full_key = f"{prefix}:{cache_key_suffix}"

                # 尝试获取缓存
                cached_val = await self.get(full_key)
                if cached_val is not None:
                    # logger.debug(f"Cache hit: {full_key}")
                    return cached_val

                # 执行函数
                result = await func(*args, **kwargs)

                # 写入缓存 (Result 必须可序列化)
                if result is not None:
                    await self.set(full_key, result, ttl=ttl)

                return result
            return wrapper
        return decorator

    # ====== 版本化缓存与防击穿辅助 ======

    async def set_with_version(
        self,
        key: str,
        value: Any,
        version: int,
        ttl: int | None = settings.CACHE_DEFAULT_TTL,
    ) -> bool:
        """带配置版本号写缓存，防止旧值复活"""
        payload = {"v": version, "data": value}
        return await self.set(key, payload, ttl=ttl)

    async def get_with_version(self, key: str, expected_version: int | None) -> Any | None:
        """读取并校验版本，不匹配时返回 None"""
        if expected_version is None:
            return await self.get(key)
        data = await self.get(key)
        if isinstance(data, dict) and data.get("v") == expected_version:
            return data.get("data")
        return None

    @staticmethod
    def jitter_ttl(ttl: int, jitter_ratio: float = 0.1) -> int:
        """为 TTL 添加抖动，防止雪崩"""
        if ttl <= 0:
            return ttl
        delta = int(ttl * jitter_ratio)
        return ttl + random.randint(-delta, delta)

    def get_script_sha(self, name: str) -> str | None:
        """获取已预加载脚本的 SHA，未加载返回 None"""
        return self._script_sha.get(name)

    async def get_or_set_singleflight(
        self,
        key: str,
        loader: Callable[[], Awaitable[Any]],
        ttl: int = settings.CACHE_DEFAULT_TTL,
        version: int | None = None,
        lock_ttl: int = 3,
    ) -> Any:
        """
        单航班缓存填充：
        - 已存在则直接返回
        - 未命中时用分布式短锁防击穿
        """
        if not self._redis:
            return await loader()

        existing = await self.get_with_version(key, version)
        if existing is not None:
            return existing

        lock_key = self._make_key(f"lock:{key}")
        got_lock = False
        try:
            got_lock = await self._redis.set(lock_key, b"1", nx=True, ex=lock_ttl)
            if got_lock:
                # Double-check after acquiring lock
                existing = await self.get_with_version(key, version)
                if existing is not None:
                    return existing

                value = await loader()
                if value is not None:
                    ttl_with_jitter = self.jitter_ttl(ttl)
                    if version is None:
                        await self.set(key, value, ttl=ttl_with_jitter)
                    else:
                        await self.set_with_version(key, value, version, ttl=ttl_with_jitter)
                return value
            else:
                # 等待持锁者填充，避免击穿
                await asyncio.sleep(0.05)
                return await self.get_with_version(key, version)
        finally:
            if got_lock:
                try:
                    await self._redis.delete(lock_key)
                except Exception:
                    pass

# 单例实例
cache = CacheService()
