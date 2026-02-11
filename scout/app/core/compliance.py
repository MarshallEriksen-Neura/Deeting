import re
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser
from loguru import logger
import asyncio

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

    # 3. 内容敏感词库 (正文包含即熔断)
    # 这是一个基础列表，生产环境建议从外部文件或配置加载
    CONTENT_SENSITIVE_KEYWORDS = [
        # 政治敏感类 (示例，实际部署需扩充)
        "涉密", "绝密", "机密", "秘密级",
        "内部资料", "严禁外传",
        "色情", "赌博", "博彩", # 基础黄赌毒
        # "反动", "暴恐" 等具体词汇根据实际合规要求添加
    ]

    # 4. 白名单 (这些域名不受合规性检查限制，常用于官方文档抓取测试)
    DOMAIN_WHITELIST = [
        "openai.com", "anthropic.com", "jina.ai", "microsoft.com", 
        "google.com", "facebook.com", "github.com"
    ]

    def __init__(self, user_agent: str = "*"):
        self.user_agent = user_agent
        self._robots_cache = {} # 简单内存缓存

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
            
        # 简单高效的字符串匹配，量大时可考虑 Aho-Corasick 算法优化
        for kw in self.CONTENT_SENSITIVE_KEYWORDS:
            if kw in text:
                logger.warning(f"🚫 Compliance Block (Sensitive Content): Found keyword '{kw}'")
                return False
        
        return True

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
                rp = RobotFileParser()
                # 使用 run_in_executor 避免阻塞异步循环
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, rp.set_url, robots_url)
                # 设置超时，防止 robots.txt 加载卡死
                await asyncio.wait_for(loop.run_in_executor(None, rp.read), timeout=5.0)
                self._robots_cache[robots_url] = rp
            
            return rp.can_fetch(self.user_agent, url)
        except Exception:
            # 获取 robots.txt 失败或超时，默认允许 (宽松模式)
            # 或者为了极致合规，这里可以 return False
            return True

# 全局合规实例
compliance_manager = ComplianceManager(user_agent="DeetingScout/1.0")