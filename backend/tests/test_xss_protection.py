"""
XSS防护工具测试
"""
import pytest
from app.utils.xss_protection import (
    sanitize_input,
    sanitize_string,
    strip_html_tags,
    escape_for_html_content,
    escape_for_html_attribute,
    escape_for_javascript_context,
    validate_and_sanitize_user_input,
    is_xss_attempt
)


def test_sanitize_string_xss_script():
    """测试XSS脚本清理"""
    malicious_input = "<script>alert('XSS')</script>"
    sanitized = sanitize_string(malicious_input)
    assert sanitized == "&lt;script&gt;alert('XSS')&lt;/script&gt;"


def test_sanitize_string_javascript_protocol():
    """测试javascript协议清理"""
    malicious_input = "Click here: javascript:alert(1)"
    sanitized = sanitize_string(malicious_input)
    assert "javascript:alert(1)" not in sanitized


def test_sanitize_string_safe_input():
    """测试安全输入保持不变"""
    safe_input = "This is a safe string with normal text."
    sanitized = sanitize_string(safe_input)
    assert sanitized == "This is a safe string with normal text."


def test_strip_html_tags():
    """测试HTML标签清理"""
    html_with_tags = '<p class="intro">Hello <script>alert(1)</script> World</p>'
    sanitized = strip_html_tags(html_with_tags)
    # script标签应该被移除或转义，p标签保留
    assert "alert(1)" not in sanitized
    assert "<p" in sanitized


def test_strip_html_tags_whitelist():
    """测试HTML标签白名单"""
    html_with_tags = '<p>Safe text</p><script>alert(1)</script><img src="image.jpg" onload="alert(1)">'
    sanitized = strip_html_tags(html_with_tags)
    # p和img标签应该保留，script标签应该被清理
    assert "<p>Safe text</p>" in sanitized
    assert "image.jpg" in sanitized
    assert "alert(1)" not in sanitized


def test_escape_for_html_content():
    """测试HTML内容转义"""
    input_str = '<script>alert("XSS")</script>'
    escaped = escape_for_html_content(input_str)
    assert escaped == "&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;"


def test_escape_for_html_attribute():
    """测试HTML属性转义"""
    input_str = '"><script>alert(1)</script>'
    escaped = escape_for_html_attribute(input_str)
    assert escaped == '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'


def test_escape_for_javascript_context():
    """测试JavaScript上下文转义"""
    input_str = '</script><script>alert(1)</script>'
    escaped = escape_for_javascript_context(input_str)
    # 应该转义引号和斜杠
    assert "\\u003c/script\\u003e" in escaped


def test_is_xss_attempt():
    """测试XSS检测"""
    assert is_xss_attempt("<script>alert(1)</script>") is True
    assert is_xss_attempt("javascript:alert(1)") is True
    assert is_xss_attempt("This is safe") is False


def test_validate_and_sanitize_user_input():
    """测试用户输入验证和清理"""
    # 测试正常输入
    result = validate_and_sanitize_user_input("Safe input")
    assert result == "Safe input"
    
    # 测试XSS输入应该抛出异常
    with pytest.raises(ValueError):
        validate_and_sanitize_user_input("<script>alert(1)</script>")
    
    # 测试字典输入
    result = validate_and_sanitize_user_input({"safe_key": "safe_value"})
    assert result == {"safe_key": "safe_value"}
    
    # 测试字典中的XSS输入
    with pytest.raises(ValueError):
        validate_and_sanitize_user_input({"xss_key": "<script>alert(1)</script>"})


def test_sanitize_input_with_complex_data():
    """测试复杂数据结构的清理"""
    complex_data = {
        "user": {
            "name": "John",
            "bio": "<script>alert('XSS')</script>Software Developer",
            "posts": [
                {"title": "First Post", "content": "Hello World"},
                {"title": "Second Post", "content": "<img src=x onerror=alert('XSS')>"}
            ]
        }
    }
    
    sanitized = sanitize_input(complex_data)
    # bio中的脚本应该被清理
    assert "alert" not in sanitized["user"]["bio"]
    # posts中的恶意内容应该被清理
    for post in sanitized["user"]["posts"]:
        assert "onerror" not in str(post)


def test_input_length_validation():
    """测试输入长度验证"""
    long_input = "a" * 10001  # 超过默认限制
    with pytest.raises(ValueError):
        validate_and_sanitize_user_input(long_input, max_length=10000)
    
    # 在限制内的长度应该通过
    result = validate_and_sanitize_user_input("a" * 9999, max_length=10000)
    assert len(result) == 9999