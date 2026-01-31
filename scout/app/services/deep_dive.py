import asyncio
from typing import Set, List, Dict, Any
from urllib.parse import urlparse, urljoin
from loguru import logger

from app.services.crawler import crawler_service
from app.core.graph import KnowledgeGraph

class DeepDiveService:
    """
    Orchestrates the recursive crawling process.
    Returns a collection of raw artifacts for the Brain to process.
    """
    
    async def dive(self, seed_url: str, max_depth: int = 2, max_pages: int = 10) -> Dict[str, Any]:
        """
        Recursively crawls a site starting from seed_url.
        Returns a dictionary containing 'artifacts' (list of pages) and 'topology' (graph data).
        """
        domain = urlparse(seed_url).netloc
        queue = asyncio.Queue()
        await queue.put((seed_url, 0)) # (url, current_depth)
        
        visited: Set[str] = set()
        artifacts: List[Dict[str, Any]] = []
        graph = KnowledgeGraph()
        
        pages_processed = 0
        
        logger.info(f"Starting Deep Dive on {seed_url} (Depth: {max_depth}, Limit: {max_pages})")
        
        while not queue.empty() and pages_processed < max_pages:
            url, depth = await queue.get()
            
            # Normalize URL (remove fragment)
            url = url.split('#')[0]
            
            if url in visited:
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
                        abs_link = urljoin(url, href).split('#')[0]
                        abs_links.append(abs_link)
                
                graph.add_page(url, title, abs_links)
                
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
                    for link in abs_links:
                        # Strict domain check to stay on the doc site
                        if urlparse(link).netloc == domain and link not in visited:
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