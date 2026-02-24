from typing import Any
import random

async def invoke(tool_name: str, args: dict[str, Any], deeting: Any) -> Any:
    """
    Weather Plugin logic.
    In a real scenario, you would use `deeting.call_tool('http_get', ...)` 
    to fetch data from an OpenWeather API.
    """
    city = args.get("city", "San Francisco")
    
    # 1. Logging for developer visibility
    deeting.log(f"Fetching weather for: {city}")
    
    # 2. Mocking data (Replace with real API call in production)
    # Using deeting.log to simulate progress
    deeting.section("Data Retrieval")
    temp = random.randint(15, 30)
    humidity = random.randint(40, 80)
    condition = random.choice(["Sunny", "Cloudy", "Rainy"])
    
    # 3. Emit a UI Block to the chat window
    deeting.render(
        view_type="weather.card",
        title=f"Weather in {city}",
        payload={
            "city": city,
            "temp": temp,
            "humidity": humidity,
            "condition": condition,
            "icon": "☀️" if condition == "Sunny" else "☁️" if condition == "Cloudy" else "🌧️"
        }
    )
    
    return {
        "summary": f"The weather in {city} is currently {condition} with a temperature of {temp}°C."
    }
