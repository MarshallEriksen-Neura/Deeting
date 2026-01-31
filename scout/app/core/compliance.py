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
        "people.com.cn",         # 重点官媒 (视需求可放开，但建议谨慎)
        "xinhuanet.com",
        "cctv.com",
    ]
    
    # 2. 敏感关键词 (URL 包含即拦截)
    SENSITIVE_KEYWORDS = [
        "zhengfu", "jiguan", "dangjian", # 政府、机关、党建
        "admin", "login", "signin",      # 尝试登录/后台 (防止误触入侵法律)
        "private", "internal",           # 内部系统
    ]

    def __init__(self, user_agent: str = "*"):
        self.user_agent = user_agent
        self._robots_cache = {} # 简单内存缓存

    async def is_safe_to_crawl(self, url: str) -> bool:
        """
        综合判断是否安全：
        1. 检查黑名单 (政治安全)
        2. 检查 Robots.txt (法律合规)
        """
        if not self._check_blacklist(url):
            logger.warning(f"Compliance Block (Blacklist): {url}")
            return False
            
        # 3. 严格遵循 Robots 协议 (可选，建议开启)
        # 很多商业反爬直接把 Robots 协议作为法律诉讼依据
        if not await self._check_robots_txt(url):
            logger.warning(f"Compliance Block (Robots.txt): {url}")
            return False
            
        return True

    def _check_blacklist(self, url: str) -> bool:
        parsed = urlparse(url)
        hostname = parsed.netloc.lower()
        path = parsed.path.lower()
        
        # 检查域名后缀
        for domain in self.DOMAIN_BLACKLIST:
            if hostname.endswith(domain) or f"{domain}." in hostname:
                return False
                
        # 检查敏感词
        full_str = f"{hostname}{path}"
        for kw in self.SENSITIVE_KEYWORDS:
            if kw in full_str:
                return False
                
        return True

    async def _check_robots_txt(self, url: str) -> bool:
        """
        异步检查 Robots.txt
        """
        parsed = urlparse(url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        
        if robots_url in self._robots_cache:
            rp = self._robots_cache[robots_url]
        else:
            rp = RobotFileParser()
            try:
                # 使用 run_in_executor 避免阻塞异步循环
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, rp.set_url, robots_url)
                await loop.run_in_executor(None, rp.read)
                self._robots_cache[robots_url] = rp
            except Exception:
                # 如果获取 robots.txt 失败（超时/404），通常默认允许，
                # 但为了安全，也可以策略性地设为 False。这里设为 True (宽松模式)。
                return True
        
        return rp.can_fetch(self.user_agent, url)

# 全局合规实例
compliance_manager = ComplianceManager(user_agent="DeetingScout/1.0")
