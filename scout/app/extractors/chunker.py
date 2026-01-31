import re
from typing import List, Dict, Any
import hashlib

class MarkdownChunker:
    """
    Semantically splits Markdown content into chunks based on Headers.
    Preserves code blocks within their parent section.
    """
    
    def split_text(self, text: str, source_url: str) -> List[Dict[str, Any]]:
        """
        Splits markdown into chunks.
        Returns a list of dicts: {'content': str, 'metadata': dict, 'id': str}
        """
        lines = text.split('\n')
        chunks = []
        current_chunk = []
        current_header = "Introduction"
        code_block_open = False
        
        for line in lines:
            # Detect code block boundaries to avoid splitting inside code
            if line.strip().startswith('```'):
                code_block_open = not code_block_open
                current_chunk.append(line)
                continue
            
            # Detect headers (H1-H3) only if not in code block
            if not code_block_open and re.match(r'^#{1,3}\s', line):
                # Save previous chunk if it has content
                if current_chunk:
                    chunk_text = '\n'.join(current_chunk).strip()
                    if len(chunk_text) > 50: # Ignore tiny chunks
                        chunks.append(self._create_chunk(chunk_text, current_header, source_url))
                
                # Start new chunk
                current_header = line.strip().lstrip('#').strip()
                current_chunk = [line]
            else:
                current_chunk.append(line)
        
        # Save last chunk
        if current_chunk:
            chunk_text = '\n'.join(current_chunk).strip()
            if len(chunk_text) > 50:
                chunks.append(self._create_chunk(chunk_text, current_header, source_url))
                
        return chunks

    def _create_chunk(self, text: str, header: str, url: str) -> Dict[str, Any]:
        # Generate a deterministic ID based on content
        content_hash = hashlib.md5(text.encode()).hexdigest()
        return {
            "id": content_hash,
            "payload": text,
            "vector": {{}}, # Placeholder for embedding
            "metadata": {
                "source": url,
                "section": header,
                "type": "documentation"
            }
        }

chunker = MarkdownChunker()
