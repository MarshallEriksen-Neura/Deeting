import asyncio
import time
from typing import Any, Dict

import httpx

# from backend.app.core.provider.config_driven_provider import get_by_path # Circular import risk. 
# I will define get_by_path here or in a utils file?
# The user provided get_by_path in the snippet. I'll put it in a common place or duplicate/include in utils.
# Let's put utils in the same file for now or create generic_utils.
# I'll put it in this file as a static method or helper function.

def get_by_path(data: Dict | list, path: str) -> Any:
    keys = path.split('.')
    curr = data
    for key in keys:
        if isinstance(curr, list) and key.isdigit():
            key = int(key)
        if isinstance(curr, dict) or isinstance(curr, list):
            try:
                curr = curr[key]
            except (IndexError, KeyError, TypeError):
                return None
        else:
            return None
    return curr

class AsyncPoller:
    """通用状态机轮询器 - 一次编写，处处运行 (Async Version)"""
    def __init__(self, config: Dict, api_key: str):
        self.config = config
        self.api_key = api_key

    async def wait_for_result(self, task_id: str, client: httpx.AsyncClient) -> Dict:
        poll_conf = self.config['poll']
        # 简单替换，实际可用 Jinja2，这里先按 User Code 实现
        url = poll_conf['url_template'].replace('{{ task_id }}', str(task_id))
        
        start_time = time.time()
        timeout = poll_conf.get('timeout', 300)
        interval = poll_conf.get('interval', 5)
        
        while time.time() - start_time < timeout:
            # 1. 发起轮询
            headers = poll_conf.get('headers', {}).copy()
            # TODO: 注入认证头 (Inject Auth Headers)
            # Assuming headers might need Authorization injection if not already in config template
            # The config template in user example has "Authorization": "Bearer {{ credentials.api_key }}"
            # But here we are in the poller. The user code snippet didn't explicitly show Jinja rendering for headers here, 
            # just `self.api_key` in init.
            # In the user's snippet: `headers = poll_conf.get('headers', {})`.
            # I'll stick to the snippet logic but ensure I copy the dict.
            
            try:
                resp = await client.request(
                    method=poll_conf.get('method', 'GET'),
                    url=url,
                    headers=headers
                )
                resp.raise_for_status()
                data = resp.json()
            except httpx.HTTPError as e:
                # Handle error or retry? 
                # For now, if polling fails (network), maybe we should retry or fail?
                # User snippet: resp.json() directly.
                # I'll assume we continue if error is 5xx? No, user snippet raises exception if status val not success.
                # But here it's network error. I will raise for now to be safe.
                raise e
            
            # 2. 检查状态
            status_loc = poll_conf['status_check']['location']
            status_val = get_by_path(data, status_loc)
            
            success_values = poll_conf['status_check']['success_values']
            fail_values = poll_conf['status_check']['fail_values']
            
            if status_val in success_values:
                return data # 成功，返回完整数据供提取
                
            if status_val in fail_values:
                raise Exception(f"Async task failed: {status_val}")
                
            await asyncio.sleep(interval)
            
        raise TimeoutError("Async polling timed out")
