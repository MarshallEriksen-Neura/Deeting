import asyncio
from collections import Counter
from typing import Set, List, Dict, Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from loguru import logger

from app.core.config import settings
from app.services.crawler import crawler_service
from app.core.graph import KnowledgeGraph

class DeepDiveService:
    """
    Orchestrates the recursive crawling process.
    Returns a collection of raw artifacts for the Brain to process.
    """

    _NOISE_PATH_SEGMENTS = {
        "login",
        "signin",
        "sign-in",
        "sign_in",
        "signup",
        "sign-up",
        "sign_up",
        "register",
        "logout",
        "password",
        "password_reset",
        "reset-password",
        "session",
        "sessions",
        "auth",
        "oauth",
        "account",
        "accounts",
        "preferences",
        "settings",
    }
    _NOISE_QUERY_KEYS = {
        "return_to",
        "redirect",
        "redirect_to",
        "redirect_uri",
        "next",
    }
    _TRACKING_QUERY_KEYS = {
        "spm",
        "ref",
        "source",
        "fbclid",
        "gclid",
        "igshid",
        "mc_cid",
        "mc_eid",
    }
    _BINARY_EXTENSIONS = {
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".svg",
        ".ico",
        ".css",
        ".js",
        ".map",
        ".zip",
        ".gz",
        ".rar",
        ".7z",
        ".exe",
        ".dmg",
        ".deb",
        ".rpm",
        ".mp4",
        ".mp3",
        ".avi",
        ".mov",
        ".woff",
        ".woff2",
        ".ttf",
    }

    @staticmethod
    def _normalize_path(path: str) -> str:
        parts = [part for part in path.split("/") if part]
        if not parts:
            return "/"
        return "/" + "/".join(parts)

    @classmethod
    def _normalize_url(cls, url: str) -> str:
        parsed = urlparse(url)
        scheme = (parsed.scheme or "https").lower()
        netloc = parsed.netloc.lower()
        path = cls._normalize_path(parsed.path or "/")

        query_items = []
        for key, value in parse_qsl(parsed.query, keep_blank_values=True):
            lower_key = key.lower()
            if lower_key.startswith("utm_") or lower_key in cls._TRACKING_QUERY_KEYS:
                continue
            query_items.append((key, value))
        query = urlencode(query_items, doseq=True)

        return urlunparse((scheme, netloc, path, "", query, ""))

    @staticmethod
    def _path_in_scope(path: str, scope_prefix: str | None) -> bool:
        if not scope_prefix:
            return True
        if path == scope_prefix:
            return True
        return path.startswith(scope_prefix + "/")

    @classmethod
    def _is_noise_url(cls, url: str) -> bool:
        parsed = urlparse(url)
        path = cls._normalize_path(parsed.path or "/").lower()
        segments = [part for part in path.split("/") if part]

        if segments:
            if any(seg in cls._NOISE_PATH_SEGMENTS for seg in segments):
                return True

            tail = segments[-1]
            for ext in cls._BINARY_EXTENSIONS:
                if tail.endswith(ext):
                    return True

        query_keys = {key.lower() for key, _ in parse_qsl(parsed.query, keep_blank_values=True)}
        if query_keys & cls._NOISE_QUERY_KEYS:
            return True

        return False

    @classmethod
    def _infer_scope_prefix(cls, seed_url: str, links: list[str]) -> str | None:
        seed = urlparse(seed_url)
        seed_segments = [part for part in cls._normalize_path(seed.path or "/").split("/") if part]
        if not seed_segments:
            return None

        candidates: list[str] = []
        if len(seed_segments) >= 2:
            candidates.append("/" + "/".join(seed_segments[:2]))
        candidates.append("/" + seed_segments[0])

        counts: Counter[str] = Counter()
        for link in links:
            parsed = urlparse(link)
            if parsed.netloc.lower() != seed.netloc.lower():
                continue
            path = cls._normalize_path(parsed.path or "/")
            for prefix in candidates:
                if cls._path_in_scope(path, prefix):
                    counts[prefix] += 1

        min_matches = max(1, int(getattr(settings, "SCOUT_DEEP_DIVE_SCOPE_MIN_MATCHES", 3) or 3))
        for prefix in candidates:
            if counts[prefix] >= min_matches:
                return prefix

        # Fallback: at least keep seed's first segment scope.
        return candidates[-1]

    @classmethod
    def _should_enqueue(
        cls,
        *,
        link: str,
        domain: str,
        scope_prefix: str | None,
    ) -> bool:
        parsed = urlparse(link)
        if parsed.scheme not in {"http", "https"}:
            return False
        if parsed.netloc.lower() != domain.lower():
            return False
        if bool(getattr(settings, "SCOUT_DEEP_DIVE_FILTER_NOISE_URLS", True)):
            if cls._is_noise_url(link):
                return False
        path = cls._normalize_path(parsed.path or "/")
        return cls._path_in_scope(path, scope_prefix)

    async def dive(self, seed_url: str, max_depth: int = 2, max_pages: int = 10) -> Dict[str, Any]:
        """
        Recursively crawls a site starting from seed_url.
        Returns a dictionary containing 'artifacts' (list of pages) and 'topology' (graph data).
        """
        seed_url = self._normalize_url(seed_url)
        domain = urlparse(seed_url).netloc
        queue = asyncio.Queue()
        await queue.put((seed_url, 0)) # (url, current_depth)

        visited: Set[str] = set()
        artifacts: List[Dict[str, Any]] = []
        graph = KnowledgeGraph()
        scope_prefix: str | None = None

        pages_processed = 0

        logger.info(f"Starting Deep Dive on {seed_url} (Depth: {max_depth}, Limit: {max_pages})")

        while not queue.empty() and pages_processed < max_pages:
            url, depth = await queue.get()
            url = self._normalize_url(url)

            if url in visited:
                continue

            # Defensive guard: children should stay in scope, only seed may initialize it.
            if depth > 0 and not self._should_enqueue(
                link=url,
                domain=domain,
                scope_prefix=scope_prefix,
            ):
                continue

            visited.add(url)
            pages_processed += 1

            # 1. Crawl (Using the Compliance-Aware CrawlerService)
            try:
                # Use JS mode only for the seed page or if specifically configured, 
                # but for bulk recursion, non-JS (if possible) is faster. 
                # Crawl4AI's 'magic' mode implies JS, so we keep js_mode=True for quality.
                result = await crawler_service.inspect_url(url, js_mode=True) 
                
                if result["status"] == "failed":
                    logger.warning(f"Skipping {url}: {result.get('error')}")
                    continue
                
                markdown = result.get("markdown", "")
                title = result.get("title", "Untitled")
                internal_links = result.get("links", {}).get("internal", [])

                # 2. Graph Update
                abs_links = []
                for link in internal_links:
                    href = link.get('href') if isinstance(link, dict) else link
                    if href:
                        abs_link = self._normalize_url(urljoin(url, href))
                        abs_links.append(abs_link)

                if depth == 0 and bool(getattr(settings, "SCOUT_DEEP_DIVE_ENFORCE_PATH_SCOPE", True)):
                    scope_prefix = self._infer_scope_prefix(seed_url, abs_links)
                    logger.info(f"Deep Dive scope inferred: {scope_prefix or '/'}")

                filtered_links = [
                    link
                    for link in abs_links
                    if self._should_enqueue(link=link, domain=domain, scope_prefix=scope_prefix)
                ]

                graph.add_page(url, title, filtered_links)

                # 3. Artifact Collection (Raw Data)
                artifacts.append({
                    "url": url,
                    "title": title,
                    "markdown": markdown,
                    "metadata": result.get("metadata", {}),
                    "depth": depth
                })

                # 4. Enqueue Children
                if depth < max_depth:
                    for link in filtered_links:
                        if link not in visited:
                            await queue.put((link, depth + 1))

            except Exception as e:
                logger.error(f"Error processing {url}: {e}")

        # 5. Analysis
        central_nodes = graph.get_central_pages()

        logger.info(f"Deep Dive completed. Found {len(artifacts)} pages.")

        return {
            "status": "completed",
            "stats": {
                "pages_crawled": pages_processed,
                "depth_reached": max_depth
            },
            "topology": {
                "central_concepts": central_nodes,
                "graph_data": graph.export_topology()
            },
            "artifacts": artifacts # List of raw pages for the Backend to digest
        }

deep_dive_service = DeepDiveService()
