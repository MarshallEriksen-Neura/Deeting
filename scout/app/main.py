from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
import os

from app.core.config import settings

def create_app() -> FastAPI:
    app = FastAPI(
        title="Deeting Scout",
        description="The Cognitive Engine for Deeting OS",
        version="0.1.0",
        openapi_url="/openapi.json",
        docs_url="/docs",
    )

    # CORS Configuration
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    async def startup_event():
        logger.info("Deeting Scout System Initializing...")
        logger.info(f"Running in {settings.ENVIRONMENT} mode")
        # 这里未来会初始化 Browser Pool 和 Database 连接

    @app.on_event("shutdown")
    async def shutdown_event():
        logger.info("Deeting Scout System Shutting Down...")

    @app.get("/health")
    async def health_check():
        return {
            "status": "healthy", 
            "service": "deeting-scout",
            "version": "0.1.0"
        }

    # Register Routes
    from app.api.endpoints import router as scout_router
    app.include_router(scout_router, prefix="/v1/scout", tags=["scout"])

    return app

app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
