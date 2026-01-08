"""Content extraction utilities using BeautifulSoup and html2text."""

from __future__ import annotations

import re
from typing import Any

import html2text
from bs4 import BeautifulSoup, NavigableString


def extract_main_content(html: str) -> str:
    """
    Extract main content from HTML using BeautifulSoup DOM distillation.

    Removes scripts, styles, navigation, ads, and focuses on article/main content.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Remove unwanted elements
    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "iframe", "noscript"]):
        tag.decompose()

    # Remove common ad/tracking classes
    ad_patterns = [
        "ad",
        "ads",
        "advertisement",
        "banner",
        "promo",
        "sidebar",
        "widget",
        "social",
        "comment",
        "share",
        "related",
        "recommended",
    ]
    for element in soup.find_all(class_=True):
        classes = " ".join(element.get("class", []))
        if any(pattern in classes.lower() for pattern in ad_patterns):
            element.decompose()

    # Try to find main content area
    main_content = None
    for tag_name in ["article", "main", '[role="main"]']:
        main_content = soup.find(tag_name)
        if main_content:
            break

    # Fallback to body if no main content found
    if not main_content:
        main_content = soup.find("body")

    if not main_content:
        return ""

    # Extract text with basic formatting
    return main_content.get_text(separator="\n", strip=True)


def extract_code_blocks(html: str) -> list[dict[str, str]]:
    """
    Extract code blocks from HTML.

    Returns list of dicts with 'language' and 'code' keys.
    """
    soup = BeautifulSoup(html, "html.parser")
    code_blocks: list[dict[str, str]] = []

    # Find pre > code blocks (common in markdown-rendered pages)
    for pre in soup.find_all("pre"):
        code = pre.find("code")
        if code:
            # Try to detect language from class (e.g., language-python, lang-python)
            language = "text"
            if code.get("class"):
                for cls in code.get("class", []):
                    if cls.startswith("language-"):
                        language = cls.replace("language-", "")
                        break
                    if cls.startswith("lang-"):
                        language = cls.replace("lang-", "")
                        break

            code_text = code.get_text(strip=False)
            if code_text:
                code_blocks.append({"language": language, "code": code_text})

    # Find standalone code blocks
    for code in soup.find_all("code"):
        # Skip if already processed as part of pre
        if code.parent and code.parent.name == "pre":
            continue

        code_text = code.get_text(strip=False)
        if code_text and len(code_text.strip()) > 10:  # Only include substantial code
            code_blocks.append({"language": "text", "code": code_text})

    return code_blocks


def extract_tables(html: str) -> list[dict[str, Any]]:
    """
    Extract table data from HTML.

    Returns list of dicts with 'headers' and 'rows' keys.
    """
    soup = BeautifulSoup(html, "html.parser")
    tables: list[dict[str, Any]] = []

    for table in soup.find_all("table"):
        # Extract headers
        headers: list[str] = []
        thead = table.find("thead")
        if thead:
            for th in thead.find_all("th"):
                headers.append(th.get_text(strip=True))

        # If no thead, try first tr
        if not headers:
            first_row = table.find("tr")
            if first_row:
                for th in first_row.find_all("th"):
                    headers.append(th.get_text(strip=True))

        # Extract rows
        rows: list[list[str]] = []
        tbody = table.find("tbody")
        if tbody:
            for tr in tbody.find_all("tr"):
                row = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
                if row:
                    rows.append(row)
        else:
            # Process all rows except header row
            all_rows = table.find_all("tr")
            start_idx = 1 if headers else 0
            for tr in all_rows[start_idx:]:
                row = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
                if row:
                    rows.append(row)

        if rows:
            tables.append({"headers": headers, "rows": rows})

    return tables


def html_to_markdown(html: str) -> str:
    """
    Convert HTML to Markdown using html2text.

    Preserves links, headers, lists, and code blocks.
    """
    converter = html2text.HTML2Text()
    converter.ignore_links = False
    converter.ignore_images = False
    converter.ignore_emphasis = False
    converter.body_width = 0  # Don't wrap lines
    converter.unicode_snob = True
    converter.skip_internal_links = True

    markdown = converter.handle(html)

    # Clean up excessive whitespace
    markdown = re.sub(r"\n\n\n+", "\n\n", markdown)

    return markdown.strip()
