import importlib


def test_extract_last_user_message_empty():
    from app.services.tools.tool_context_service import extract_last_user_message

    assert extract_last_user_message([]) == ""


def test_extract_last_user_message_returns_last_user():
    from app.services.tools.tool_context_service import extract_last_user_message

    messages = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "ok"},
        {"role": "user", "content": "need tools"},
    ]
    assert extract_last_user_message(messages) == "need tools"


def test_tool_context_service_importable():
    module = importlib.import_module("app.services.tools.tool_context_service")
    assert module.tool_context_service is not None
