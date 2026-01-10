# Playwright Crawler Service

Web crawling service using Playwright for DOM distillation, content extraction, and code block recognition.

## Components

### 1. `browser.py` - Browser Management
- **PlaywrightManager**: Singleton class for managing browser lifecycle
- **Methods**:
  - `start()`: Initialize Playwright and launch browser
  - `stop()`: Clean shutdown
  - `new_context(**kwargs)`: Create isolated browser context
  - `new_page(context, **kwargs)`: Create new page

### 2. `extractor.py` - Content Extraction
- **extract_main_content(html)**: DOM distillation - removes nav, ads, scripts
- **extract_code_blocks(html)**: Identifies code blocks with language detection
- **extract_tables(html)**: Extracts table data with headers and rows
- **html_to_markdown(html)**: Converts HTML to Markdown preserving structure

### 3. `runner.py` - Crawler Execution
- **CrawlRunner.run(url, config)**: Main entry point
  - Validates URL (SSRF protection)
  - Launches browser
  - Waits for network idle
  - Extracts structured content
  - Returns: `{url, title, text, markdown, code_blocks, tables, status, error}`

## SSRF Protection

Blocks:
- Private IP ranges (10.x, 172.16.x, 192.168.x)
- Localhost (127.x, ::1)
- Link-local (169.254.x)
- Dangerous ports (22, 23, 25, 3306, 5432, 6379, 27017)

## Usage

```python
from app.services.crawler import CrawlRunner
from app.services.crawler.runner import CrawlConfig

# Basic usage
result = await CrawlRunner.run("https://example.com")

# With config
config = CrawlConfig(
    wait_for="networkidle",
    timeout=30000,
    extract_markdown=True,
    extract_tables=True,
    extract_code=True,
)
result = await CrawlRunner.run("https://example.com", config)

# Result structure
{
    "url": "https://example.com",
    "title": "Page Title",
    "text": "Main content...",
    "markdown": "# Page Title\n\n...",
    "code_blocks": [{"language": "python", "code": "..."}],
    "tables": [{"headers": [...], "rows": [[...]]}],
    "status": 200,
    "error": None
}
```

## Dependencies

- `playwright` - Browser automation
- `beautifulsoup4` - HTML parsing
- `html2text` - HTML to Markdown conversion

## Testing

All core features tested:
- ✓ Basic crawling (https://example.com)
- ✓ SSRF protection (blocks private IPs)
- ✓ Code block extraction
- ✓ Table extraction
