---
name: crawler
description: "Universal web crawling and content extraction skill."
---

# Scout Crawler

## Overview

The Scout Crawler is a versatile tool for extracting structured information from the web. It can fetch individual pages, render JavaScript-heavy sites, or recursively crawl an entire domain to build a knowledge base.

## Core Tools

- `fetch_web_content`: Fetches the clean, readable content of a single URL and returns it in Markdown format. Useful for quick information retrieval from articles or documentation.
- `crawl_website`: Automatically follows links from a starting URL to a specified depth and page count. Ideal for comprehensive domain analysis or preparing data for RAG (Retrieval-Augmented Generation).

## Usage Guidelines

- **Rule 1: Use JS Mode**: Always keep `js_mode=true` for modern web applications (SPAs) like React or Vue sites to ensure content is fully rendered.
- **Rule 2: Respect Robots.txt**: Be aware that excessive crawling can be blocked by servers. Use moderate `max_depth` and `max_pages` for broad crawls.
- **Rule 3: URL Precision**: Ensure URLs include the scheme (e.g., `https://`).

## Anti-Patterns

- **Avoid Deep Crawls on Large Sites**: Do NOT set high `max_depth` on massive domains (like Wikipedia or Amazon) as it will waste resources and may get blocked.
- **Do NOT use for API endpoints**: This tool is designed for human-readable web pages, not for raw JSON/XML APIs.
