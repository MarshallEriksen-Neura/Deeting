from __future__ import annotations

from app.models.upstream_secret import UpstreamSecret
from app.repositories.base import BaseRepository


class UpstreamSecretRepository(BaseRepository[UpstreamSecret]):
    model = UpstreamSecret
