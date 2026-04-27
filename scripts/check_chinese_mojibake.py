#!/usr/bin/env python3
"""Detect likely Chinese mojibake in repository text files.

Default usage scans tracked source/text files:

    python scripts/check_chinese_mojibake.py

Pre-commit passes staged filenames as arguments, so only those files are
checked before a commit.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


TEXT_EXTENSIONS = {
    ".adoc",
    ".bash",
    ".c",
    ".cmd",
    ".cpp",
    ".cs",
    ".css",
    ".go",
    ".h",
    ".hpp",
    ".html",
    ".java",
    ".js",
    ".json",
    ".jsx",
    ".kt",
    ".md",
    ".mdx",
    ".mjs",
    ".ps1",
    ".py",
    ".rs",
    ".scss",
    ".sh",
    ".sql",
    ".svelte",
    ".swift",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".vue",
    ".yaml",
    ".yml",
}

TEXT_FILENAMES = {
    ".dockerignore",
    ".editorconfig",
    ".env.example",
    ".gitignore",
    "AGENTS.md",
    "Dockerfile",
    "LICENSE",
    "Makefile",
    "README",
    "README.md",
    "SKILL.md",
}

SKIP_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".next",
    ".nuxt",
    ".omc",
    ".omx",
    ".ruff_cache",
    ".turbo",
    ".uv-cache",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "target",
    "vendor",
}

MOJIBAKE_MARKERS = tuple(
    "\u95c2 \u7f02 \u9354 \u7efe \u6d93 \u93c2 \u9422 \u6dc7 \u6769 "
    "\u93b5 \u6924 \u59af \u6d60 \u6d63 \u5bf0 \u59dd \u9428 \u70d8 "
    "\u9359 \u7487 \u93c3 \u93cd \u93c4 \u6434 \u95ab \u93c9 \u7ee0 "
    "\u7039 \u95b2 \u93c1 \u93bb \u6e1a \u74ba \u941e \u7f01 \u941c"
    .split()
)

REPLACEMENT_CHAR_RE = re.compile("\ufffd")
LITERAL_POWERSHELL_NEWLINE_RE = re.compile("`r" + "`n")
CHINESE_MOJIBAKE_RE = re.compile("|".join(re.escape(marker) for marker in MOJIBAKE_MARKERS))
LATIN1_UTF8_MOJIBAKE_RE = re.compile(
    r"(?:"
    r"\u00c3[\u0080-\u00bf]"
    r"|\u00c2[\u0080-\u00bf]"
    r"|\u00e2[\u0080-\u00bf]"
    r"|(?:\u00e4\u00b8|\u00e4\u00ba|\u00e4\u00bd|\u00e6.|\u00e7.|\u00e5.)"
    r")"
)


@dataclass(frozen=True)
class Finding:
    path: Path
    line: int
    column: int
    rule: str
    snippet: str


def repo_root() -> Path:
    try:
        output = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return Path.cwd()
    return Path(output.strip())


def git_tracked_files(root: Path) -> list[Path]:
    try:
        output = subprocess.check_output(
            ["git", "-C", str(root), "ls-files", "-z"],
            stderr=subprocess.DEVNULL,
        )
    except (OSError, subprocess.CalledProcessError):
        return [path for path in root.rglob("*") if path.is_file()]
    return [root / name.decode("utf-8", "surrogateescape") for name in output.split(b"\0") if name]


def expand_inputs(root: Path, args: Iterable[str]) -> list[Path]:
    paths: list[Path] = []
    for raw in args:
        path = Path(raw)
        if not path.is_absolute():
            path = root / path
        if path.is_dir():
            paths.extend(child for child in path.rglob("*") if child.is_file())
        else:
            paths.append(path)
    return paths


def should_skip(path: Path, root: Path) -> bool:
    try:
        relative = path.relative_to(root)
    except ValueError:
        relative = path

    if any(part in SKIP_DIRS for part in relative.parts):
        return True
    if not path.exists() or not path.is_file():
        return True
    if path.name in TEXT_FILENAMES:
        return False
    return path.suffix.lower() not in TEXT_EXTENSIONS


def read_utf8(path: Path) -> tuple[str | None, Finding | None]:
    data = path.read_bytes()
    if b"\0" in data:
        return None, None
    try:
        return data.decode("utf-8"), None
    except UnicodeDecodeError as error:
        snippet_start = max(0, error.start - 16)
        snippet_end = min(len(data), error.end + 16)
        snippet = data[snippet_start:snippet_end].hex(" ")
        return None, Finding(
            path=path,
            line=1,
            column=max(1, error.start + 1),
            rule="invalid-utf8",
            snippet=f"bytes: {snippet}",
        )


def line_findings(path: Path, text: str) -> list[Finding]:
    findings: list[Finding] = []
    checks = (
        ("replacement-char", REPLACEMENT_CHAR_RE),
        ("literal-powershell-newline", LITERAL_POWERSHELL_NEWLINE_RE),
        ("chinese-mojibake", CHINESE_MOJIBAKE_RE),
        ("latin1-utf8-mojibake", LATIN1_UTF8_MOJIBAKE_RE),
    )
    for line_number, line in enumerate(text.splitlines(), start=1):
        for rule, pattern in checks:
            match = pattern.search(line)
            if not match:
                continue
            snippet = line.strip()
            if len(snippet) > 160:
                snippet = f"{snippet[:157]}..."
            findings.append(
                Finding(
                    path=path,
                    line=line_number,
                    column=match.start() + 1,
                    rule=rule,
                    snippet=snippet,
                )
            )
            break
    return findings


def scan(paths: Iterable[Path], root: Path) -> list[Finding]:
    findings: list[Finding] = []
    seen: set[Path] = set()
    for path in paths:
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if should_skip(resolved, root):
            continue
        text, decode_finding = read_utf8(resolved)
        if decode_finding:
            findings.append(decode_finding)
            continue
        if text is None:
            continue
        findings.extend(line_findings(resolved, text))
    return findings


def display_path(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", help="Files or directories to scan.")
    parser.add_argument(
        "--stdin0",
        action="store_true",
        help="Read additional NUL-separated paths from stdin.",
    )
    parser.add_argument(
        "--max-findings",
        type=int,
        default=100,
        help="Maximum findings to print before truncating output.",
    )
    args = parser.parse_args(argv)

    root = repo_root()
    input_paths = list(args.paths)
    if args.stdin0:
        input_paths.extend(
            raw.decode("utf-8", "surrogateescape")
            for raw in sys.stdin.buffer.read().split(b"\0")
            if raw
        )

    if input_paths:
        candidates = expand_inputs(root, input_paths)
    elif args.stdin0:
        candidates = []
    else:
        candidates = git_tracked_files(root)
    findings = scan(candidates, root)

    if not findings:
        print("Chinese mojibake check passed.")
        return 0

    print("Chinese mojibake check failed. Fix the suspicious text before committing.", file=sys.stderr)
    for finding in findings[: args.max_findings]:
        path = display_path(finding.path, root)
        print(
            f"{path}:{finding.line}:{finding.column}: {finding.rule}: {finding.snippet}",
            file=sys.stderr,
        )
    remaining = len(findings) - args.max_findings
    if remaining > 0:
        print(f"... {remaining} more finding(s) omitted.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
