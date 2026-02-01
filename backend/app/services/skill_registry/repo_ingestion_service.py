from __future__ import annotations

from typing import Iterable

from app.services.skill_registry.parsers.base import RepoContext, RepoParserPlugin


class RepoIngestionService:
    def __init__(self, parsers: Iterable[RepoParserPlugin]):
        self.parsers = list(parsers)

    def select_parser(self, repo_context: RepoContext) -> RepoParserPlugin:
        for parser in self.parsers:
            if parser.can_handle(repo_context):
                return parser
        raise ValueError("No parser available for repo")

    def build_evidence(self, repo_context: RepoContext):
        parser = self.select_parser(repo_context)
        return parser.collect_evidence(repo_context)

    def extract_manifest(self, repo_context: RepoContext) -> dict:
        parser = self.select_parser(repo_context)
        evidence = parser.collect_evidence(repo_context)
        return parser.extract_manifest(evidence)
