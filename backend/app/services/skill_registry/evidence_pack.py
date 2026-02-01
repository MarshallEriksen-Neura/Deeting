from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class EvidencePack:
    max_files: int = 10
    files: list[str] = field(default_factory=list)
    readme: str | None = None
    dependencies: list[str] = field(default_factory=list)
    entrypoints: list[str] = field(default_factory=list)
    snippets: list[str] = field(default_factory=list)
    metadata: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if len(self.files) > self.max_files:
            self.files = self.files[: self.max_files]

    @property
    def file_count(self) -> int:
        return len(self.files)
