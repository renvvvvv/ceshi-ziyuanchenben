"""Qwen Vision (DashScope) backend for image recognition."""

from __future__ import annotations

import base64
import json
import os
import re
import time

from .base import BackendError, ImageRecognitionBackend, RecognitionResult


class QwenVisionBackend(ImageRecognitionBackend):
    """Qwen vision models via Alibaba Cloud DashScope API (阿里云百炼)."""

    def __init__(self, api_key: str, model: str = "qwen-vl-max",
                 max_tokens: int = 4096, timeout_sec: int = 120):
        self.api_key = api_key
        self.model = model
        self.max_tokens = max_tokens
        self.timeout_sec = timeout_sec
        self._validate_sdk()

    def _validate_sdk(self):
        try:
            import dashscope
            self._dashscope = dashscope
            dashscope.api_key = self.api_key
        except ImportError:
            raise BackendError(
                "dashscope SDK not installed. Run: pip install dashscope"
            )

    @property
    def name(self) -> str:
        return f"Qwen ({self.model})"

    def recognize(self, image_path: str, system_prompt: str) -> RecognitionResult:
        warnings: list[str] = []

        # 1. Encode image as base64 data URL
        try:
            media_type, b64_data = self._encode_image(image_path)
        except (FileNotFoundError, OSError, ValueError) as e:
            raise BackendError(f"Cannot read image: {e}")

        file_size = os.path.getsize(image_path)
        if file_size > 20 * 1024 * 1024:
            warnings.append("Image > 20 MB, API may reject or be slow")

        # 2. Build user message: system prompt + extraction instruction combined
        user_text = (
            f"{system_prompt}\n\n"
            f"Extract all visible data center parameters from this image and return JSON."
        )

        messages = [{
            "role": "user",
            "content": [
                {"image": f"data:{media_type};base64,{b64_data}"},
                {"text": user_text},
            ],
        }]

        # 3. Call API with retry
        last_error = None
        for attempt in range(3):
            try:
                from dashscope import MultiModalConversation

                response = MultiModalConversation.call(
                    model=self.model,
                    messages=messages,
                    max_length=self.max_tokens,
                )

                if response.status_code != 200:
                    raise BackendError(
                        f"API returned status {response.status_code}: {response.message}"
                    )

                raw = response.output.choices[0].message.content[0]["text"]
                parsed = self._try_parse(raw)
                if parsed is None:
                    warnings.append("Could not parse AI response as JSON")
                return RecognitionResult(
                    raw_response=raw,
                    parsed=parsed,
                    warnings=warnings,
                )

            except BackendError:
                raise
            except Exception as e:
                last_error = e
                msg = str(e).lower()
                if "rate" in msg or "throttl" in msg or "limit" in msg:
                    if attempt < 2:
                        time.sleep((attempt + 1) * 5)
                        continue
                    raise BackendError(f"Rate limited. Try again later: {e}")
                if "timeout" in msg:
                    raise BackendError(f"API timeout: {e}")
                if "auth" in msg or "401" in str(e) or "403" in str(e):
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
            with open(path, "rb") as f:
                header = f.read(12)
            if header[:4] == b"\x89PNG":
                media_type = "image/png"
            elif header[:2] == b"\xff\xd8":
                media_type = "image/jpeg"
            elif header[:4] == b"RIFF" and header[8:12] == b"WEBP":
                media_type = "image/webp"
            else:
                raise ValueError(f"Unsupported image format: {ext}")

        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode("ascii")
        return media_type, data

    def _try_parse(self, text: str) -> dict | None:
        """Try to parse JSON from AI response, with markdown-fence fallback."""
        text = text.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if m:
            try:
                return json.loads(m.group(1).strip())
            except json.JSONDecodeError:
                pass
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
        return None
