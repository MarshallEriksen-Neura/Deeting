"""
AI Higress Gateway - FastAPI Application Entry Point

启动命令:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi_pagination import add_pagination

from app.core import cache, settings, setup_logging
from app.middleware.concurrency import concurrency_middleware
from app.middleware.metrics import metrics_middleware
from app.middleware.trace import trace_middleware

# 安全中间件
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.middleware.request_validator import RequestValidatorMiddleware


# 设置日志
setup_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    from app.core.logging import logger

    logger.info("application_startup", extra={"project": settings.PROJECT_NAME})
    try:
        cache.init()
        await cache.preload_scripts()
    except Exception as exc:
        logger.warning(f"cache_init_failed: {exc}")

    yield

    try:
        await cache.close()
    except Exception:
        pass
    logger.info("application_shutdown")


def create_app() -> FastAPI:
    """创建 FastAPI 应用"""
    app = FastAPI(
        title=settings.PROJECT_NAME,
        openapi_url=f"{settings.API_V1_STR}/openapi.json",
        lifespan=lifespan,
    )

    # 全局中间件：顺序为追踪 -> 背压 -> 指标 -> 安全中间件 -> CORS
    app.middleware("http")(trace_middleware)
    app.middleware("http")(concurrency_middleware)
    app.middleware("http")(metrics_middleware)

    # 安全相关中间件：仅在安全中间件启用时添加
    if settings.ENABLE_SECURITY_MIDDLEWARE:
        from app.core.logging import logger
        logger.info("Enabling security middleware stack")
        
        # 添加安全头中间件
        app.add_middleware(
            SecurityHeadersMiddleware,
            enable_hsts=settings.ENABLE_HSTS,
            hsts_max_age=settings.HSTS_MAX_AGE,
        )

        # 添加请求验证中间件
        app.add_middleware(
            RequestValidatorMiddleware,
            enable_sql_injection_check=settings.SECURITY_SQL_INJECTION_DETECT,
            enable_xss_check=settings.SECURITY_XSS_PROTECTION,
            enable_path_traversal_check=True,
            enable_command_injection_check=True,
            enable_user_agent_check=True,
            log_suspicious_requests=True,
            inspect_body=settings.INSPECT_REQUEST_BODY,
            inspect_body_max_length=settings.INSPECT_BODY_MAX_LENGTH,
            ban_ip_on_detection=settings.BAN_IP_ON_DETECTION,
            ban_ttl_seconds=settings.BAN_TTL_SECONDS,
            # Redis 在 lifespan 中初始化，这里提供惰性获取函数，初始化后自动切换到 Redis 存储
            redis_client_provider=lambda: getattr(cache, "_redis", None),
        )
    else:
        from app.core.logging import logger
        logger.warning(
            "Security middleware stack is disabled; set ENABLE_SECURITY_MIDDLEWARE=True to enable."
        )

    # CORS 配置
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.BACKEND_CORS_ORIGINS,
        allow_credentials=settings.BACKEND_CORS_ALLOW_CREDENTIALS,
        allow_methods=settings.BACKEND_CORS_ALLOW_METHODS,
        allow_headers=settings.BACKEND_CORS_ALLOW_HEADERS,
    )

    # 注册路由
    register_routes(app)
    add_pagination(app)

    return app


def register_routes(app: FastAPI) -> None:
    """注册所有 API 路由"""
    # Auth 路由
    from app.api.metrics_route import router as metrics_router
    from app.api.v1 import (
        admin_api_keys_router,
        admin_users_router,
        admin_assistants_router,
        admin_registration_router,
        admin_provider_credential_router,
        admin_provider_instance_router,
        admin_discovery_router,
        auth_router,
        user_api_keys_router,
        available_models_router,
        external_gateway_router,
        internal_bridge_router,
        internal_gateway_router,
        internal_conversation_router,
        media_router,
        users_router,
        provider_router,
        gateway_logs_router,
        dashboard_router,
        monitoring_router,
        credits_router,
    )

    api_prefix = settings.API_V1_STR

    app.include_router(auth_router, prefix=api_prefix, tags=["Authentication"])
    app.include_router(users_router, prefix=api_prefix, tags=["Users"])
    app.include_router(user_api_keys_router, prefix=api_prefix, tags=["API Keys"])
    app.include_router(available_models_router, prefix=api_prefix, tags=["Models"])
    app.include_router(admin_users_router, prefix=api_prefix, tags=["Admin - Users"])
    app.include_router(admin_api_keys_router, prefix=api_prefix, tags=["Admin - API Keys"])
    app.include_router(admin_assistants_router, prefix=api_prefix, tags=["Admin - Assistants"])
    app.include_router(admin_registration_router, prefix=api_prefix, tags=["Admin - Registration"])
    app.include_router(
        admin_provider_credential_router, prefix=api_prefix, tags=["Admin - Provider Credentials"]
    )
    app.include_router(admin_provider_instance_router, prefix=api_prefix, tags=["Admin - Provider Instances"])
    app.include_router(admin_discovery_router, prefix=api_prefix, tags=["Admin - Discovery Agent"])

    # Gateway 路由
    app.include_router(
        external_gateway_router, prefix=f"{api_prefix}/external", tags=["Gateway"]
    )
    # 兼容文档与测试所用的外部通道前缀 `/external/v1`
    app.include_router(
        external_gateway_router, prefix="/external/v1", tags=["Gateway"]
    )
    app.include_router(
        internal_gateway_router, prefix=f"{api_prefix}/internal", tags=["Gateway"]
    )
    app.include_router(
        internal_bridge_router, prefix=f"{api_prefix}/internal", tags=["Bridge"]
    )
    app.include_router(
        internal_conversation_router, prefix=f"{api_prefix}/internal", tags=["Conversations"]
    )
    app.include_router(provider_router, prefix=api_prefix, tags=["Providers"])
    app.include_router(media_router, prefix=api_prefix, tags=["Media"])
    app.include_router(gateway_logs_router, prefix=api_prefix, tags=["Logs"])
    app.include_router(dashboard_router, prefix=api_prefix, tags=["Dashboard"])
    app.include_router(monitoring_router, prefix=api_prefix, tags=["Monitoring"])
    app.include_router(credits_router, prefix=api_prefix, tags=["Credits"])
    # Metrics
    app.include_router(metrics_router, tags=["Metrics"])


# 创建应用实例
app = create_app()


def run():
    """脚本入口点"""
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
    )


if __name__ == "__main__":
    run()
