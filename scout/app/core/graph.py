import networkx as nx
from typing import List, Dict, Any
from urllib.parse import urlparse

class KnowledgeGraph:
    """
    In-memory graph structure to track crawled pages and their relationships.
    Uses NetworkX to detect clusters and central pages.
    """
    def __init__(self):
        self.graph = nx.DiGraph()
    
    def add_page(self, url: str, title: str, links: List[str]):
        """
        Add a page node and edges to its out-links.
        """
        self.graph.add_node(url, title=title, type="page")
        
        domain = urlparse(url).netloc
        
        for link in links:
            # Only track internal links for the graph topology
            if urlparse(link).netloc == domain:
                self.graph.add_edge(url, link)

    def get_central_pages(self, top_k: int = 5) -> List[str]:
        """
        Return the most 'central' pages using PageRank.
        These are likely the core concepts of the documentation.
        """
        if not self.graph:
            return []
            
        try:
            scores = nx.pagerank(self.graph)
            sorted_nodes = sorted(scores.items(), key=lambda x: x[1], reverse=True)
            return [node for node, score in sorted_nodes[:top_k]]
        except Exception:
            return []

    def export_topology(self) -> Dict[str, Any]:
        """
        Export the graph structure for visualization or debugging.
        """
        return nx.node_link_data(self.graph)
