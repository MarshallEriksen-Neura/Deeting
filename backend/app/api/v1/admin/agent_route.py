from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

from app.services.agent_service import agent_service
# from app.deps.superuser import get_current_superuser

router = APIRouter()

class AgentChatRequest(BaseModel):
    query: str
    model_hint: str = "gpt-4-turbo"
    history: Optional[List[Dict[str, Any]]] = None
    
    # Allow overriding the system persona
    system_instruction: Optional[str] = None 

class AgentChatResponse(BaseModel):
    response: str

# Default Persona for "Provider Catalog Agent"
CATALOG_AGENT_PROMPT = (
    "You are the 'Gateway Catalog Agent'. Your goal is to populate and maintain the Provider Preset marketplace.\n"
    "Capabilities:\n"
    "1. Crawler: Fetch provider documentation or landing pages.\n"
    "2. Registry: Get internal standard schemas.\n"
    "3. Database: Check, Create, or Update Provider Presets.\n\n"
    "When asked to 'crawl and store', you should:\n"
    "- Crawl the provided URL to understand the provider's API.\n"
    "- Check if a preset for this provider already exists.\n"
    "- Create a new Provider Preset if missing, or update it with new information.\n"
    "Always report back which presets you managed."
)

@router.post("/agent/chat", response_model=AgentChatResponse)
async def chat_with_admin_agent(
    payload: AgentChatRequest,
    # current_user = Depends(get_current_superuser) 
):
    """
    Chat with the Admin Agent.
    By default, acts as a Catalog Agent, but can be instructed to perform other tasks
    (e.g., Knowledge Base ingestion) if the corresponding plugins are registered.
    """
    try:
        # Use provided instruction or fallback to Catalog default
        instruction = payload.system_instruction or CATALOG_AGENT_PROMPT
        
        response_text = await agent_service.chat(
            user_query=payload.query,
            system_instruction=instruction,
            model_hint=payload.model_hint,
            conversation_history=payload.history
        )
        return AgentChatResponse(response=response_text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))