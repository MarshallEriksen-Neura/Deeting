from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class RepoContext:
    repo_url: str
    revision: str
    root_path: Path
    file_index: list[str] = field(default_factory=list)


@dataclass
class EvidencePack:
    readme: str | None = None
    dependencies: list[str] = field(default_factory=list)
    entrypoints: list[str] = field(default_factory=list)
    snippets: list[str] = field(default_factory=list)
    metadata: dict[str, str] = field(default_factory=dict)


class RepoParserPlugin(ABC):
    @abstractmethod
    def can_handle(self, repo_context: RepoContext) -> bool:
        raise NotImplementedError

    @abstractmethod
    def collect_evidence(self, repo_context: RepoContext) -> EvidencePack:
        raise NotImplementedError

    @abstractmethod
    def extract_manifest(self, evidence: EvidencePack) -> dict:
        raise NotImplementedError
