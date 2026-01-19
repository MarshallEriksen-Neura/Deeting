from typing import Any, List
import uuid
import json
from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.schemas.plan import ExecutionPlan, TaskItem

class PlannerPlugin(AgentPlugin):
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="system/planner",
            version="1.0.0",
            description="Architect capabilities: Design execution plans and manage workflows.",
            author="System"
        )

    def get_tools(self) -> List[Any]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "propose_execution_plan",
                    "description": "Propose a multi-step execution plan for the user to approve. Use this when the request is complex.",
                    "parameters": ExecutionPlan.model_json_schema()
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "retrieve_similar_plans",
                    "description": "Search the Knowledge Base for similar past plans to reuse.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "The user's current request description"}
                        },
                        "required": ["query"]
                    }
                }
            }
        ]

    async def handle_propose_execution_plan(self, **kwargs) -> str:
        """
        The Agent calls this tool to 'output' the plan.
        In a real scenario, we might save this to a DB table 'plans' with status 'pending_approval'.
        For now, we return it as a JSON string so the Frontend can render the graph.
        """
        # Ensure ID
        if "plan_id" not in kwargs:
            kwargs["plan_id"] = str(uuid.uuid4())
            
        try:
            plan = ExecutionPlan(**kwargs)
            # In a real app: await plan_repo.save(plan)
            return json.dumps(plan.model_dump(), default=str)
        except Exception as e:
            return f"Error creating plan: {e}"

    async def handle_retrieve_similar_plans(self, query: str) -> str:
        """
        Mock implementation of RAG retrieval.
        In the future, this will call Qdrant.
        """
        # TODO: Implement Qdrant Search
        # embedding = await embedding_service.embed(query)
        # results = await qdrant.search("plans", vector=embedding)
        
        # Mock Response for demo
        if "crawl" in query.lower() and "openai" in query.lower():
            mock_plan = {
                "title": "Crawl OpenAI Docs (Template)",
                "rationale": "Standard crawler pattern for documentation sites.",
                "tasks": [
                    {
                        "id": "t1", 
                        "title": "Crawl Overview", 
                        "tool_name": "fetch_web_content", 
                        "tool_args": {"url": "https://platform.openai.com/docs/overview"},
                        "dependencies": []
                    },
                    {
                        "id": "t2", 
                        "title": "Ingest Models", 
                        "tool_name": "submit_background_ingestion_job", 
                        "tool_args": {"url": "https://platform.openai.com/docs/models", "instruction": "Extract models"},
                        "dependencies": ["t1"]
                    }
                ]
            }
            return f"Found a similar plan template:\n{json.dumps(mock_plan)}"
            
        return "No similar plans found in Knowledge Base."
