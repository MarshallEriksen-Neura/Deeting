from typing import Any, List
from celery.result import AsyncResult

from app.agent_plugins.core.interfaces import AgentPlugin, PluginMetadata
from app.tasks.agent import run_auto_ingestion_job

class TaskSchedulerPlugin(AgentPlugin):
    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="system/task_scheduler",
            version="1.0.0",
            description="Spawns background worker agents to handle long-running tasks.",
            author="System"
        )

    def get_tools(self) -> List[Any]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "submit_background_ingestion_job",
                    "description": "Spawn a background worker to crawl a URL and follow instructions to ingest data (e.g. create presets). Use this for heavy crawling tasks.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "url": {
                                "type": "string", 
                                "description": "The target URL to process."
                            },
                            "instruction": {
                                "type": "string", 
                                "description": "Specific goal for the worker (e.g. 'Extract all provider info and save as presets')."
                            }
                        },
                        "required": ["url", "instruction"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "check_job_status",
                    "description": "Check the status and result of a background job.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "job_id": {"type": "string"}
                        },
                        "required": ["job_id"]
                    }
                }
            }
        ]

    async def submit_background_ingestion_job(self, url: str, instruction: str) -> str:
        """
        Trigger the Celery task.
        """
        task = run_auto_ingestion_job.apply_async(args=[url, instruction])
        return f"Job submitted successfully. Job ID: {task.id}. I can check its status later."

    async def check_job_status(self, job_id: str) -> str:
        """
        Check Celery task result.
        """
        result = AsyncResult(job_id)
        if result.ready():
            if result.successful():
                return f"Job Completed. Result: {result.result}"
            else:
                return f"Job Failed. Error: {str(result.result)}"
        else:
            return "Job is still running."
