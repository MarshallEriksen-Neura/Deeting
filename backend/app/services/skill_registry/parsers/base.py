from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

from app.services.skill_registry.evidence_pack import EvidencePack


@dataclass
class RepoContext:
    repo_url: str
    revision: str
    root_path: Path
    file_index: list[str] = field(default_factory=list)


class RepoParserPlugin(ABC):
    @property
    def is_authoritative(self) -> bool:
        """If True, the manifest from this parser is considered complete and reliable."""
        return False

    @abstractmethod
    def can_handle(self, repo_context: RepoContext) -> bool:
        raise NotImplementedError

    @abstractmethod
    def collect_evidence(self, repo_context: RepoContext) -> EvidencePack:
        raise NotImplementedError

    @abstractmethod
    def extract_manifest(self, evidence: EvidencePack) -> dict:
        raise NotImplementedError
