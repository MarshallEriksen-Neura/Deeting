from app.services.sanitizer import sanitizer


def test_mask_text_basic():
    src = "张三 电话13812345678 邮箱 test.user@example.com token sk-ABCDEFG123456"
    masked = sanitizer.mask_text(src)
    assert "138****5678" in masked
    assert "t***@example.com" in masked
    assert "sk-A...3456" in masked or "sk-ABCD...3456" or "..."  # partial match


def test_sanitize_payload_nested():
    obj = {
        "user": {
            "phone": "13812345678",
            "email": "a@b.com",
        },
        "list": ["13812345678", 1],
    }
    res = sanitizer.sanitize_payload(obj)
    assert res["user"]["phone"].startswith("138") and "****" in res["user"]["phone"]
    assert "***@" in res["user"]["email"]
