"""Abstract base for image recognition backends."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


class BackendError(Exception):
    """Wraps backend-specific errors (API, network, auth) for uniform handling."""


@dataclass
class RecognitionResult:
    raw_response: str
    parsed: dict | None = None
    warnings: list[str] = field(default_factory=list)


class ImageRecognitionBackend(ABC):
    """Extract data center parameters from an image via an AI vision backend."""

    @property
    @abstractmethod
    def name(self) -> str:
        ...

    @abstractmethod
    def recognize(self, image_path: str, system_prompt: str) -> RecognitionResult:
        ...
