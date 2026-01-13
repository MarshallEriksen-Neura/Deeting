import logging
import sys

from loguru import logger

from app.core.config import settings


class InterceptHandler(logging.Handler):
    """
    拦截标准库 logging 消息并转发到 Loguru
    """
    def emit(self, record):
        # 获取对应的 Loguru level
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        # 获取调用栈深度
        frame, depth = logging.currentframe(), 2
        while frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(
            level, record.getMessage()
        )

def setup_logging():
    """
    配置 Loguru 日志
    """
    # 移除 Loguru 默认的 handler
    logger.remove()

    # 1. 输出到控制台
    logger.add(
        sys.stderr,
        level=settings.LOG_LEVEL,
        format="<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        serialize=settings.LOG_JSON_FORMAT,  # 如果是 True，则输出 JSON 格式，适合 ELK
        enqueue=settings.LOG_ASYNC,  # 测试环境可关闭队列以规避 semlock 权限问题
        backtrace=True,
        diagnose=True,
    )

    # 2. 输出到文件 (如果有路径配置)
    if settings.LOG_FILE_PATH:
        logger.add(
            settings.LOG_FILE_PATH,
            rotation=settings.LOG_ROTATION,
            retention=settings.LOG_RETENTION,
            level=settings.LOG_LEVEL,
            format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level: <8} | {name}:{function}:{line} - {message}",
            encoding="utf-8",
            enqueue=settings.LOG_ASYNC,
            compression="zip", # 轮转后压缩
        )

    # 3. 拦截标准库 logging (Uvicorn, FastAPI, SQLAlchemy 等)
    logging.basicConfig(handlers=[InterceptHandler()], level=0)

    # 调整第三方库的日志级别，避免噪音
    logging.getLogger("uvicorn.access").handlers = [InterceptHandler()]
    logging.getLogger("uvicorn.error").handlers = [InterceptHandler()]

    # Uvicorn debug 热重载依赖 watchfiles，会以 INFO 级别反复输出 "1 change detected"
    # 将其日志级别提升到 WARNING，避免开发模式下刷屏
    logging.getLogger("watchfiles").setLevel(logging.WARNING)
    logging.getLogger("watchfiles.main").setLevel(logging.WARNING)

    # Uvicorn debug 热重载依赖 watchfiles，会以 INFO 级别反复输出 "1 change detected"
    # 将其日志级别提升到 WARNING，避免开发模式下刷屏
    logging.getLogger("watchfiles").setLevel(logging.WARNING)
    logging.getLogger("watchfiles.main").setLevel(logging.WARNING)

    # 将 logging 模块的根 logger 设置为配置的级别
    logging.getLogger("root").setLevel(settings.LOG_LEVEL)

    # 可以在这里根据需要设置特定库的级别
    # logging.getLogger("sqlalchemy.engine").setLevel(logging.INFO if settings.DEBUG else logging.WARNING)

    return logger
