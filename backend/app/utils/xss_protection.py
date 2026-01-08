"""
XSS防护工具模块：输入验证、输出转义和内容安全策略
"""
import html
import re
from typing import Union, List, Dict, Any

# XSS攻击模式正则表达式
XSS_PATTERNS = [
    # 脚本标签
    re.compile(r"<script[^>]*>.*?</script>", re.IGNORECASE | re.DOTALL),
    re.compile(r"<iframe[^>]*>.*?</iframe>", re.IGNORECASE | re.DOTALL),
    re.compile(r"<embed[^>]*>.*?</embed>", re.IGNORECASE | re.DOTALL),
    re.compile(r"<object[^>]*>.*?</object>", re.IGNORECASE | re.DOTALL),
    re.compile(r"<form[^>]*>.*?</form>", re.IGNORECASE | re.DOTALL),
    
    # 事件处理器
    re.compile(r"on\w+\s*=", re.IGNORECASE),
    
    # 危险协议
    re.compile(r"javascript:", re.IGNORECASE),
    re.compile(r"data:", re.IGNORECASE),
    re.compile(r"vbscript:", re.IGNORECASE),
    
    # URL编码的攻击
    re.compile(r"%3Cscript%3E.*?%3C/script%3E", re.IGNORECASE | re.DOTALL),
    re.compile(r"&#x?[0-9A-Fa-f]*[;,]?", re.IGNORECASE),
    
    # CSS注入
    re.compile(r"expression\s*\(", re.IGNORECASE),
    re.compile(r"url\s*\(\s*javascript:", re.IGNORECASE),
    
    # 其他潜在危险模式
    re.compile(r"<meta[^>]*http-equiv[^>]*refresh", re.IGNORECASE | re.DOTALL),
    re.compile(r"<link[^>]*rel=[\"']import[\"']", re.IGNORECASE | re.DOTALL),
]

# HTML标签白名单（用于HTML净化）
HTML_WHITELIST = {
    'p', 'br', 'br/', 'strong', 'em', 'u', 'ol', 'ul', 'li', 
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'pre', 'code', 'hr',
    'div', 'span', 'small',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'img', 'a'
}

HTML_ATTRIBUTES_WHITELIST = {
    'img': ['src', 'alt', 'title', 'width', 'height'],
    'a': ['href', 'title', 'target'],
    'div': ['class', 'id'],
    'span': ['class', 'id'],
    'p': ['class', 'id'],
    'h1': ['class', 'id'],
    'h2': ['class', 'id'],
    'h3': ['class', 'id'],
    'h4': ['class', 'id'],
    'h5': ['class', 'id'],
    'h6': ['class', 'id'],
}


def sanitize_input(input_data: Union[str, Dict[str, Any], List[Any]]) -> Union[str, Dict[str, Any], List[Any]]:
    """
    清理输入数据，防止XSS攻击
    
    Args:
        input_data: 输入数据，可以是字符串、字典或列表
        
    Returns:
        清理后的数据
    """
    if isinstance(input_data, str):
        return sanitize_string(input_data)
    elif isinstance(input_data, dict):
        sanitized_dict = {}
        for key, value in input_data.items():
            sanitized_key = sanitize_string(str(key)) if isinstance(key, str) else key
            sanitized_dict[sanitized_key] = sanitize_input(value)
        return sanitized_dict
    elif isinstance(input_data, list):
        return [sanitize_input(item) for item in input_data]
    else:
        return input_data


def sanitize_string(input_str: str) -> str:
    """
    清理字符串，移除或转义潜在的XSS攻击代码
    
    Args:
        input_str: 待清理的字符串
        
    Returns:
        清理后的字符串
    """
    if not input_str:
        return input_str

    # 首先HTML解码，处理可能的编码攻击
    decoded_str = html.unescape(input_str)
    
    # 检查是否包含XSS模式
    for pattern in XSS_PATTERNS:
        if pattern.search(decoded_str):
            # 如果发现XSS模式，进行HTML转义
            return html.escape(input_str, quote=True)
    
    # 移除危险的HTML标签和属性
    sanitized = strip_html_tags(decoded_str)
    
    # HTML转义特殊字符
    return html.escape(sanitized, quote=True)


def strip_html_tags(html_str: str, allowed_tags: set = None, allowed_attrs: dict = None) -> str:
    """
    从HTML字符串中移除不需要的HTML标签，只保留白名单中的标签和属性
    
    Args:
        html_str: HTML字符串
        allowed_tags: 允许的标签集合
        allowed_attrs: 允许的属性字典
        
    Returns:
        清理后的HTML字符串
    """
    if not html_str:
        return html_str

    if allowed_tags is None:
        allowed_tags = HTML_WHITELIST
    if allowed_attrs is None:
        allowed_attrs = HTML_ATTRIBUTES_WHITELIST

    # 正则表达式匹配HTML标签
    tag_pattern = re.compile(r'<(/?)(\w+)([^>]*)>', re.IGNORECASE)
    
    def replace_tag(match):
        full_match = match.group(0)
        is_closing = match.group(1)
        tag_name = match.group(2).lower()
        
        if tag_name not in allowed_tags:
            # 不在白名单中的标签，转义整个标签
            return html.escape(full_match, quote=True)
        
        # 处理标签属性
        attrs = match.group(3)
        if attrs and tag_name in allowed_attrs:
            # 过滤属性
            filtered_attrs = []
            for attr_match in re.finditer(r'(\w+)\s*=\s*([\'"]?)(.*?)\2', attrs):
                attr_name = attr_match.group(1).lower()
                quote = attr_match.group(2)
                attr_value = attr_match.group(3)
                
                # 检查属性是否在白名单中
                if attr_name in allowed_attrs.get(tag_name, []):
                    # 检查属性值是否安全
                    if is_safe_attr_value(attr_name, attr_value):
                        filtered_attrs.append(f'{attr_name}={quote}{attr_value}{quote}')
            
            if filtered_attrs:
                return f'<{is_closing}{tag_name} {" ".join(filtered_attrs)}>'
            else:
                return f'<{is_closing}{tag_name}>'
        else:
            # 没有属性或标签不需要属性，直接返回
            return f'<{is_closing}{tag_name}>'
    
    return tag_pattern.sub(replace_tag, html_str)


def is_safe_attr_value(attr_name: str, attr_value: str) -> bool:
    """
    检查属性值是否安全，不包含XSS攻击代码
    
    Args:
        attr_name: 属性名
        attr_value: 属性值
        
    Returns:
        属性值是否安全
    """
    # 检查URL属性值
    if attr_name in ['src', 'href', 'action']:
        return not re.search(r'javascript:|vbscript:|data:', attr_value, re.IGNORECASE)
    
    # 检查事件处理器属性
    if attr_name.startswith('on'):
        return False
    
    # 检查样式属性
    if attr_name == 'style':
        return not re.search(r'expression|javascript:|url\s*\(\s*javascript:', attr_value, re.IGNORECASE)
    
    return True


def escape_for_html_content(text: str) -> str:
    """
    为HTML内容转义特殊字符
    
    Args:
        text: 待转义的文本
        
    Returns:
        转义后的文本
    """
    if not text:
        return text
    return html.escape(text, quote=True)


def escape_for_html_attribute(text: str) -> str:
    """
    为HTML属性值转义特殊字符
    
    Args:
        text: 待转义的文本
        
    Returns:
        转义后的文本
    """
    if not text:
        return text
    return html.escape(text, quote=True)


def escape_for_javascript_context(text: str) -> str:
    """
    为JavaScript上下文转义特殊字符
    
    Args:
        text: 待转义的文本
        
    Returns:
        转义后的文本
    """
    if not text:
        return text
    
    # 转义JavaScript特殊字符
    text = text.replace('\\', '\\\\')
    text = text.replace('\'', '\\\'')
    text = text.replace('\"', '\\\"')
    text = text.replace('\n', '\\n')
    text = text.replace('\r', '\\r')
    text = text.replace('\t', '\\t')
    text = text.replace('</', '<\\/')
    
    return text


def validate_and_sanitize_user_input(data: Union[str, Dict[str, Any], List[Any]], 
                                   max_length: int = 10000) -> Union[str, Dict[str, Any], List[Any]]:
    """
    验证和清理用户输入，包括长度检查和XSS检查
    
    Args:
        data: 用户输入数据
        max_length: 最大长度限制
        
    Returns:
        清理后的数据
        
    Raises:
        ValueError: 当输入数据不符合要求时
    """
    if isinstance(data, str):
        # 检查长度
        if len(data) > max_length:
            raise ValueError(f"输入数据长度超过限制: {len(data)} > {max_length}")
        
        # 检查XSS模式
        for pattern in XSS_PATTERNS:
            if pattern.search(data):
                raise ValueError("输入数据包含潜在的XSS攻击代码")
        
        return sanitize_string(data)
    elif isinstance(data, dict):
        sanitized_dict = {}
        for key, value in data.items():
            sanitized_key = validate_and_sanitize_user_input(str(key), max_length) if isinstance(key, str) else key
            sanitized_dict[sanitized_key] = validate_and_sanitize_user_input(value, max_length)
        return sanitized_dict
    elif isinstance(data, list):
        return [validate_and_sanitize_user_input(item, max_length) for item in data]
    else:
        return data


def generate_csp_header(report_only: bool = False) -> Dict[str, str]:
    """
    生成内容安全策略(CSP)响应头
    
    Args:
        report_only: 是否为报告模式
        
    Returns:
        CSP响应头字典
    """
    csp_policy = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; "
        "font-src 'self' data:; "
        "connect-src 'self' https:; "
        "frame-ancestors 'none'; "
        "object-src 'none'; "
        "base-uri 'self';"
    )
    
    header_name = "Content-Security-Policy-Report-Only" if report_only else "Content-Security-Policy"
    return {header_name: csp_policy}


def is_xss_attempt(input_str: str) -> bool:
    """
    检查输入是否包含XSS攻击尝试
    
    Args:
        input_str: 待检查的字符串
        
    Returns:
        是否包含XSS攻击
    """
    if not input_str:
        return False
    
    # HTML解码
    decoded_str = html.unescape(input_str)
    
    # 检查XSS模式
    for pattern in XSS_PATTERNS:
        if pattern.search(decoded_str):
            return True
    
    return False