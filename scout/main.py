import os
import uvicorn

if __name__ == "__main__":
    env = os.getenv("ENVIRONMENT", "development")
    if env == "development":
        uvicorn.run("app.main:app", host="0.0.0.0", port=8001, reload=True)
    else:
        uvicorn.run(
            "app.main:app",
            host="0.0.0.0",
            port=8001,
            workers=int(os.getenv("SCOUT_WORKERS", 4)),
        )
