import asyncio
import json
from typing import Any
from pydantic import BaseModel

from app.services.provider.request_transformer import RequestTransformer
from app.services.provider.response_adapter import ResponseAdapter

class MockRequest(BaseModel):
    model: str
    input: str
    voice: str
    speed: float

def test_transformation():
    print("Testing Request Transformation...")
    transformer = RequestTransformer()
    
    request = MockRequest(
        model="my-model",
        input="Hello world",
        voice="alloy",
        speed=1.0
    )
    
    # Minimax-style mapping
    input_map = {
        "model": "model",
        "voice_id": "voice",
        "speed_factor": "speed",
        "text": "input"
    }
    
    result = transformer.transform(request, input_map)
    print(f"Transformed Result: {json.dumps(result, indent=2)}")
    
    assert result["voice_id"] == "alloy"
    assert result["speed_factor"] == 1.0
    assert result["text"] == "Hello world"
    print("✅ Request Transformation OK")

def test_adaptation():
    print("\nTesting Response Adaptation...")
    adapter = ResponseAdapter()
    
    # Provider returns a nested URL
    provider_response = {
        "status": "success",
        "output": {
            "files": [
                {"download_url": "https://example.com/audio.mp3"}
            ]
        }
    }
    
    output_map = {
        "url_extractor": "output.files[0].download_url"
    }
    
    result = adapter.adapt_audio_response(provider_response, output_map)
    print(f"Adapted Result: {json.dumps(result, indent=2)}")
    
    assert result["url"] == "https://example.com/audio.mp3"
    print("✅ Response Adaptation OK")

if __name__ == "__main__":
    test_transformation()
    test_adaptation()
