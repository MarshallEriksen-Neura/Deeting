import httpx
from typing import Dict, Any, Optional
from jinja2 import Environment, BaseLoader
from .async_poller import AsyncPoller, get_by_path

class ConfigDrivenProvider:
    """
    New Kernel: Configuration Driven Provider
    Executes a request based on resolved configuration (templates, async flow, etc.)
    """
    
    def __init__(self, config: Dict[str, Any]):
        """
        :param config: Resolved configuration dict containing:
               - upstream_url: str
               - request_template: dict (body template)
               - headers: dict (header template)
               - async_config: dict
               - http_method: str
        """
        self.config = config
        self.jinja_env = Environment(loader=BaseLoader())

    def _render_template(self, template: Any, context: Dict) -> Any:
        if isinstance(template, str):
            # Render string with Jinja2
            return self.jinja_env.from_string(template).render(**context)
        elif isinstance(template, dict):
            return {k: self._render_template(v, context) for k, v in template.items()}
        elif isinstance(template, list):
            return [self._render_template(v, context) for v in template]
        return template

    def _normalize_location(self, path: str | None) -> str:
        if not path:
            return ""
        if path.startswith("body."):
            return path[5:]
        if path == "body":
            return ""
        return path

    def _extract_result(self, payload: dict[str, Any], extraction_config: dict[str, Any]) -> dict[str, Any]:
        location = self._normalize_location(extraction_config.get("location") or "")
        result_format = extraction_config.get("format") or "raw"

        extracted = get_by_path(payload, location) if location else payload
        
        if result_format == "url_list":
            urls = extracted if isinstance(extracted, list) else []
            return {"data": [{"url": url} for url in urls if isinstance(url, str)]}
        if result_format == "b64_list":
            items = extracted if isinstance(extracted, list) else []
            return {"data": [{"b64_json": item} for item in items if isinstance(item, str)]}
        
        # Default raw or mapped
        return extracted if isinstance(extracted, dict) else {"data": extracted}

    async def execute(self, request_payload: Dict, client: httpx.AsyncClient, extra_context: Dict = None) -> Dict:
        """
        Execute the provider call.
        
        :param request_payload: Input parameters (prompt, model, etc.)
        :param client: httpx.AsyncClient instance
        :param extra_context: Additional context for template rendering (e.g. credentials, system parameters)
        """
        # 1. Build Render Context
        context = {
            "input": request_payload,
            "model": {"uid": request_payload.get("model", "")},
            # "base_url": ... (can be passed in extra_context if needed)
        }
        if extra_context:
            context.update(extra_context)

        # 2. Render Headers & Body
        headers_template = self.config.get('headers', {})
        body_template = self.config.get('request_template', {})
        
        req_headers = self._render_template(headers_template, context)
        req_body = self._render_template(body_template, context)
        
        # 3. Get URL & Method
        url = self.config.get('upstream_url')
        if not url:
            raise ValueError("Upstream URL is missing in configuration")
            
        method = self.config.get('http_method', 'POST')
        
        # 4. Send Request (Upstream Call)
        resp = await client.request(method, url, headers=req_headers, json=req_body)
        resp.raise_for_status()
        
        response_data = resp.json()

        # 5. Async Flow
        async_config = self.config.get('async_config', {})
        if async_config.get('enabled'):
            # Extract Task ID
            task_id_info = async_config.get('task_id_extraction', {})
            # "key_path" or "path"
            task_id_loc = task_id_info.get('key_path') or task_id_info.get('path')
            
            task_id = get_by_path(response_data, task_id_loc)
            
            # Start Polling
            # Use api_key from context credentials
            api_key = context.get('credentials', {}).get('api_key', '')
            
            poller = AsyncPoller(async_config, api_key=api_key)
            final_response_data = await poller.wait_for_result(task_id, client)
            response_data = final_response_data
            
            # 6. Result Normalization (Async only usually requires this)
            if async_config.get("result_extraction"):
                 response_data = self._extract_result(response_data, async_config["result_extraction"])
        
        return response_data
