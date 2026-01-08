
import hashlib
import hmac
import time
import uuid

from locust import HttpUser, between, task


class AIHigressUser(HttpUser):
    # 模拟用户行为的时间间隔
    wait_time = between(1, 3)

    # 预定义的测试凭证 (建议通过环境变量传入)
    # 这些是在 init_test_env.py 中生成的或预存在的
    API_KEY = "sk-ext-test-key-placeholder"
    API_SECRET = "test-secret-placeholder"
    MODEL = "gpt-3.5-turbo" # 确保数据库中有对应的模型配置

    def on_start(self):
        """用户启动时的初始化"""
        # 如果需要从外部加载 Key，可以在这里实现
        pass

    def _generate_signature(self, timestamp, nonce):
        """
        根据网关算法生成签名
        message = f"{api_key}{timestamp}{nonce}"
        signature = HMAC-SHA256(secret, message)
        """
        message = f"{self.API_KEY}{timestamp}{nonce}"
        signature = hmac.new(
            self.API_SECRET.encode(),
            message.encode(),
            hashlib.sha256
        ).hexdigest()
        return signature

    @task(3)
    def chat_completion(self):
        """测试核心对话接口 (非流式)"""
        timestamp = str(int(time.time()))
        nonce = uuid.uuid4().hex

        payload = {
            "model": self.MODEL,
            "messages": [
                {"role": "user", "content": "Hello, how are you today?"}
            ],
            "stream": False
        }

        signature = self._generate_signature(timestamp, nonce)

        headers = {
            "X-API-Key": self.API_KEY,
            "X-Api-Secret": self.API_SECRET,
            "X-Timestamp": timestamp,
            "X-Nonce": nonce,
            "X-Signature": signature,
            "Content-Type": "application/json"
        }

        with self.client.post(
            "/api/v1/external/chat/completions",
            json=payload,
            headers=headers,
            catch_response=True,
            name="/chat/completions (Normal)"
        ) as response:
            if response.status_code == 200:
                response.success()
            elif response.status_code == 402:
                response.failure("Insufficient balance (402)")
            elif response.status_code == 429:
                response.failure("Rate limited (429)")
            else:
                response.failure(f"Unexpected status: {response.status_code}")

    @task(1)
    def chat_completion_stream(self):
        """测试核心对话接口 (流式)"""
        timestamp = str(int(time.time()))
        nonce = uuid.uuid4().hex

        payload = {
            "model": self.MODEL,
            "messages": [
                {"role": "user", "content": "Tell me a short story about a robot."}
            ],
            "stream": True
        }

        signature = self._generate_signature(timestamp, nonce)

        headers = {
            "X-API-Key": self.API_KEY,
            "X-Api-Secret": self.API_SECRET,
            "X-Timestamp": timestamp,
            "X-Nonce": nonce,
            "X-Signature": signature,
            "Content-Type": "application/json"
        }

        with self.client.post(
            "/api/v1/external/chat/completions",
            json=payload,
            headers=headers,
            stream=True,
            catch_response=True,
            name="/chat/completions (Stream)"
        ) as response:
            if response.status_code == 200:
                # 对于流式响应，我们简单地读取一些数据来模拟真实客户端
                for line in response.iter_lines():
                    if line:
                        pass
                response.success()
            else:
                response.failure(f"Stream failed: {response.status_code}")

    @task(1)
    def list_models(self):
        """测试模型列表接口 (较轻量)"""
        # 注意：models 接口当前在代码中可能不需要签名（取决于实现）
        # 但为了安全测试，我们可以带上
        headers = {
            "X-API-Key": self.API_KEY
        }
        self.client.get("/api/v1/external/models", headers=headers, name="/models")

# 启动提示：
# locust -f backend/tests/performance/locustfile_main.py --host http://localhost:8000
