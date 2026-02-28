from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser
from loguru import logger
import httpx
import re

class ComplianceManager:
    """
    Scout 的法律与合规引擎。
    确保爬虫永远不触碰 '高压线'。
    """
    
    # 1. 绝对禁飞区 (政府、军事、执法)
    DOMAIN_BLACKLIST = [
        ".gov.cn", ".gov",       # 政府
        ".mil.cn", ".mil",       # 军事
        ".police.cn",            # 警方
        ".politics",             # 政治相关顶级域
        "people.com.cn",         # 重点官媒
        "xinhuanet.com",
        "cctv.com",
        "81.cn",                 # 中国军网
    ]
    
    # 2. URL 敏感关键词 (URL 包含即拦截)
    URL_SENSITIVE_KEYWORDS = [
        "zhengfu", "jiguan", "dangjian", # 政府、机关、党建
        "admin", "login", "signin",      # 尝试登录/后台
        "private", "internal",           # 内部系统
        "vpn.", "intranet."              # 内网特征
    ]

    # 3. 内容敏感词库 (正文匹配即熔断)
    # 使用正则匹配，并为明确的误伤短语提供豁免。
    CONTENT_SENSITIVE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
        ("涉密", re.compile(r"涉密")),
        ("绝密", re.compile(r"绝密")),
        ("机密", re.compile(r"机密")),
        ("秘密级", re.compile(r"秘密级")),
        ("内部资料", re.compile(r"内部资料")),
        ("严禁外传", re.compile(r"严禁外传")),
        ("色情", re.compile(r"色情")),
        ("赌博", re.compile(r"赌博")),
        ("博彩", re.compile(r"博彩")),
    )
    CONTENT_SENSITIVE_EXEMPT_PHRASES: dict[str, tuple[str, ...]] = {
        # “出色情节”中的“色情”为“出色 + 情节”的跨词子串，不应触发合规拦截
        "色情": ("出色情节",),
    }

    # 4. 白名单 (这些域名不受合规性检查限制，常用于官方文档抓取测试)
    DOMAIN_WHITELIST = [
        "openai.com", "anthropic.com", "jina.ai", "microsoft.com", 
        "google.com", "facebook.com", "github.com"
    ]

    def __init__(self, user_agent: str = "*"):
        self.user_agent = user_agent
        self._robots_cache: dict[str, RobotFileParser | None] = {}  # 简单内存缓存

    async def is_safe_to_crawl(self, url: str) -> bool:
        """
        [Pre-Flight] 飞行前检查：
        1. 检查白名单 (快速通行)
        2. 检查黑名单 (政治安全)
        3. 检查 Robots.txt (法律合规)
        """
        parsed = urlparse(url)
        hostname = parsed.netloc.lower()
        
        # 0. 白名单快速通行
        for white_domain in self.DOMAIN_WHITELIST:
            if hostname.endswith(white_domain):
                logger.info(f"✅ Compliance Whitelist Match: {hostname}")
                return True

        if not self._check_blacklist(url):
            logger.warning(f"🚫 Compliance Block (Blacklist URL): {url}")
            return False
            
        # 3. 严格遵循 Robots 协议
        if not await self._check_robots_txt(url):
            logger.warning(f"🚫 Compliance Block (Robots.txt): {url}")
            return False
            
        return True

    def is_content_safe(self, text: str) -> bool:
        """
        [Post-Flight] 落地后安检：
        检查抓取回来的 Markdown 内容是否包含敏感词。
        """
        if not text:
            return True
            
        for kw, pattern in self.CONTENT_SENSITIVE_PATTERNS:
            for match in pattern.finditer(text):
                if self._is_exempt_keyword_match(text, kw, match.start()):
                    continue
                logger.warning(f"🚫 Compliance Block (Sensitive Content): Found keyword '{kw}'")
                return False
        
        return True

    def _is_exempt_keyword_match(self, text: str, keyword: str, match_start: int) -> bool:
        exempt_phrases = self.CONTENT_SENSITIVE_EXEMPT_PHRASES.get(keyword, ())
        if not exempt_phrases:
            return False

        for phrase in exempt_phrases:
            kw_offset = phrase.find(keyword)
            if kw_offset < 0:
                continue
            phrase_start = match_start - kw_offset
            if phrase_start >= 0 and text.startswith(phrase, phrase_start):
                return True
        return False

    def _check_blacklist(self, url: str) -> bool:
        try:
            parsed = urlparse(url)
            hostname = parsed.netloc.lower()
            path = parsed.path.lower()
            
            # 检查域名后缀
            for domain in self.DOMAIN_BLACKLIST:
                if hostname.endswith(domain) or f"{domain}." in hostname:
                    return False
                    
            # 检查敏感词
            full_str = f"{hostname}{path}"
            for kw in self.URL_SENSITIVE_KEYWORDS:
                if kw in full_str:
                    return False
            return True
        except Exception:
            return False

    async def _check_robots_txt(self, url: str) -> bool:
        """
        异步检查 Robots.txt
        """
        try:
            parsed = urlparse(url)
            robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
            
            if robots_url in self._robots_cache:
                rp = self._robots_cache[robots_url]
            else:
                robots_txt = await self._fetch_robots_txt(robots_url)
                if not robots_txt:
                    # robots 拉取失败时按“宽松模式”放行，避免误伤正常站点
                    self._robots_cache[robots_url] = None
                    return True
                rp = RobotFileParser()
                rp.set_url(robots_url)
                rp.parse(robots_txt.splitlines())
                self._robots_cache[robots_url] = rp
            
            if rp is None:
                return True

            return rp.can_fetch(self.user_agent, url)
        except Exception:
            # 获取 robots.txt 失败或超时，默认允许 (宽松模式)
            # 或者为了极致合规，这里可以 return False
            return True

    async def _fetch_robots_txt(self, robots_url: str) -> str | None:
        """
        使用当前 UA 拉取 robots.txt，避免默认 urllib UA 被目标站封禁导致误判 disallow_all。
        """
        headers = {"User-Agent": self.user_agent}
        try:
            async with httpx.AsyncClient(
                timeout=5.0,
                follow_redirects=True,
                headers=headers,
            ) as client:
                response = await client.get(robots_url)
        except Exception as exc:
            logger.warning(f"robots fetch failed for {robots_url}: {exc}")
            return None

        if response.status_code >= 400:
            logger.warning(
                f"robots fetch returned {response.status_code} for {robots_url}; fallback to allow in relaxed mode."
            )
            return None

        return response.text

# 全局合规实例
compliance_manager = ComplianceManager(user_agent="DeetingScout/1.0")
