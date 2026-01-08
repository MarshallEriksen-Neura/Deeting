
import hashlib
import hmac
import time
import uuid

from locust import HttpUser, between, task


class DegradeTestUser(HttpUser):
    """
    专门用于测试降级路径和多臂赌徒 (Bandit) 切换的压力脚本。
    建议针对一个配置了多个 Provider 的模型运行。
    """
    wait_time = between(0.5, 2)

    API_KEY = "sk-ext-test-key-placeholder"
    API_SECRET = "test-secret-placeholder"
    # 使用一个已知有多个上游的模型
    MODEL = "gpt-3.5-turbo"

    def _generate_signature(self, timestamp, nonce):
        message = f"{self.API_KEY}{timestamp}{nonce}"
        signature = hmac.new(
            self.API_SECRET.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()
        return signature

    @task
    def test_failover(self):
        """
        高频率请求，观察在某些上游报错时，网关是否能自动切换到备用上游。
        """
        timestamp = str(int(time.time()))
        nonce = uuid.uuid4().hex

        payload = {
            "model": self.MODEL,
            "messages": [{"role": "user", "content": "Trigger failover test."}],
            "stream": False
        }

        signature = self._generate_signature(timestamp, nonce)

        headers = {
            "X-API-Key": self.API_KEY,
            "X-Api-Secret": self.API_SECRET,
            "X-Timestamp": timestamp,
            "X-Nonce": nonce,
            "X-Signature": signature
        }

        with self.client.post(
            "/api/v1/external/chat/completions",
            json=payload,
            headers=headers,
            catch_response=True,
            name="Degrade/Failover Test"
        ) as response:
            # 在降级测试中，我们关注 P95 延迟的抖动和错误归因
            if response.status_code == 200:
                # 检查响应头，看是否触发了降级（如果网关在 header 中透传了 source）
                source = response.headers.get("X-Gateway-Source", "unknown")
                if source == "degraded":
                    response.success() # 标记为成功，但属于降级成功
                else:
                    response.success()
            else:
                # 记录详细错误以便分析
                try:
                    err_detail = response.json()
                    response.failure(f"Error Source: {err_detail.get('source')} Code: {err_detail.get('code')}")
                except:
                    response.failure(f"Status {response.status_code}")

# 建议在运行此脚本时，手动关闭或限制某一个上游 Provider 的访问权限，
# 观察 Bandit 算法是否会将流量自动转移到健康的 Provider。
