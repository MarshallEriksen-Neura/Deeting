from pydantic import BaseModel, Field, HttpUrl
from typing import Optional

class DiscoveryTaskRequest(BaseModel):
    """请求接入新厂商/能力的描述"""
    target_url: str = Field(..., description="API Documentation URL to crawl")
    capability: str = Field("chat", description="chat, image_generation, etc.")
    model_hint: str = Field("gpt-4o", description="The powerful model to run this discovery agent")
    provider_name_hint: Optional[str] = Field(None, description="Optional name of the provider")

class DiscoveryTaskResponse(BaseModel):
    """任务提交成功的响应"""
    task_id: str
    status: str = "pending"
