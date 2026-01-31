from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    ENVIRONMENT: str = "development"
    
    # Redis Configuration (Task Queue)
    REDIS_URL: str = "redis://redis:6379/1"
    
    # Qdrant Configuration (Memory)
    QDRANT_URL: str = "http://qdrant:6333"
    QDRANT_API_KEY: Optional[str] = None
    
    # LLM Configuration (For Extraction)
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    
    # Scout Configuration
    MAX_CONCURRENT_CRAWLS: int = 5
    DEFAULT_USER_AGENT: str = "DeetingScout/1.0 (AI Cognitive Engine; +http://deeting.ai)"

    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()
