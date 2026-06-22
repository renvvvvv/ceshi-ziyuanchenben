"""Claude Vision API backend for image recognition."""

from __future__ import annotations

import base64
import json
import os
import re
import time

from .base import BackendError, ImageRecognitionBackend, RecognitionResult


class ClaudeVisionBackend(ImageRecognitionBackend):
    def __init__(self, api_key: str, model: str = "claude-sonnet-4-20250514",
                 max_tokens: int = 4096, timeout_sec: int = 120):
        self.api_key = api_key
        self.model = model
        self.max_tokens = max_tokens
        self.timeout_sec = timeout_sec

        try:
            import anthropic
            self._client = anthropic.Anthropic(api_key=api_key, timeout=timeout_sec)
        except ImportError:
            raise BackendError(
                "anthropic SDK not installed. Run: pip install anthropic"
            )

    @property
    def name(self) -> str:
        return f"Claude ({self.model})"

    def recognize(self, image_path: str, system_prompt: str) -> RecognitionResult:
        warnings: list[str] = []

        # 1. Encode image
        try:
            media_type, b64_data = self._encode_image(image_path)
        except (FileNotFoundError, OSError, ValueError) as e:
            raise BackendError(f"Cannot read image: {e}")

        # 2. Check file size
        file_size = os.path.getsize(image_path)
        if file_size > 20 * 1024 * 1024:
            warnings.append("Image > 20 MB, API may reject or be slow")

        # 3. Call API with retry
        last_error = None
        for attempt in range(3):
            try:
                response = self._client.messages.create(
                    model=self.model,
                    max_tokens=self.max_tokens,
                    system=system_prompt,
                    messages=[{
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": b64_data,
                                },
                            },
                            {
                                "type": "text",
                                "text": "Extract all visible data center parameters from this image and return JSON.",
                            },
                        ],
                    }],
                )
                raw = response.content[0].text
                parsed = self._try_parse(raw)
                if parsed is None:
                    warnings.append("Could not parse AI response as JSON")
                return RecognitionResult(
                    raw_response=raw,
                    parsed=parsed,
                    warnings=warnings,
                )

            except Exception as e:
                last_error = e
                cls_name = type(e).__name__
                if "RateLimit" in cls_name or "rate" in str(e).lower():
                    if attempt < 2:
                        wait = (attempt + 1) * 5
                        time.sleep(wait)
                        continue
                    raise BackendError(f"Rate limited. Try again later: {e}")
                if "Timeout" in cls_name or "timeout" in str(e).lower():
                    raise BackendError(f"API timeout: {e}")
                if "Auth" in cls_name or "auth" in str(e).lower() or "401" in str(e):
                    raise BackendError(f"Authentication failed. Check your API key: {e}")
                raise BackendError(f"API error: {e}")

        raise BackendError(f"All retries exhausted: {last_error}")

    def _encode_image(self, path: str) -> tuple[str, str]:
        """Read image file and return (media_type, base64_string)."""
        ext = os.path.splitext(path)[1].lower()
        media_map = {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".bmp": "image/bmp",
        }
        media_type = media_map.get(ext)
        if not media_type:
            # Try to detect from header bytes
            with open(path, "rb") as f:
                header = f.read(12)
            if header[:4] == b"\x89PNG":
                media_type = "image/png"
            elif header[:2] == b"\xff\xd8":
                media_type = "image/jpeg"
            elif header[:4] == b"RIFF" and header[8:12] == b"WEBP":
                media_type = "image/webp"
            elif header[:3] == b"GIF":
                media_type = "image/gif"
            elif header[:2] == b"BM":
                media_type = "image/bmp"
            else:
                raise ValueError(f"Unsupported image format: {ext}")

        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode("ascii")
        return media_type, data

    def _try_parse(self, text: str) -> dict | None:
        """Try to parse JSON from AI response, with markdown-fence fallback."""
        text = text.strip()
        # Direct parse
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
        # Try extracting from ```json ... ``` fences
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if m:
            try:
                return json.loads(m.group(1).strip())
            except json.JSONDecodeError:
                pass
        # Try finding first { ... } block
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
        return None
