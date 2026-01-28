from app.services.tools.tool_context_service import extract_last_user_message


def test_extract_last_user_message_empty():
    assert extract_last_user_message([]) == ""


def test_extract_last_user_message_returns_last_user():
    messages = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "ok"},
        {"role": "user", "content": "need tools"},
    ]
    assert extract_last_user_message(messages) == "need tools"
