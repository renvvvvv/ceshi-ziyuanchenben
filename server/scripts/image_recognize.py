#!/usr/bin/env python3
"""AI-powered image recognition for data center parameter extraction."""

from __future__ import annotations

import argparse
import json
import os
import sys

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

from imgproc import register_backend, get_backend
from imgproc.claude_vision import ClaudeVisionBackend
from imgproc.qwen_vision import QwenVisionBackend
from imgproc.schema import validate_input
from imgproc.prompt import SYSTEM_PROMPT
from imgproc.interactive import interactive_edit

register_backend("claude", ClaudeVisionBackend)
register_backend("qwen", QwenVisionBackend)

BACKEND_ENV_VARS = {
    "claude": "ANTHROPIC_API_KEY",
    "qwen": "DASHSCOPE_API_KEY",
}

BACKEND_DEFAULT_MODELS = {
    "claude": "claude-sonnet-4-20250514",
    "qwen": "qwen-vl-max",
}


def _resolve_api_key(args) -> str | None:
    """Resolution order: CLI arg > env var (backend-specific) > config file."""
    if args.api_key:
        return args.api_key
    env_var = BACKEND_ENV_VARS.get(args.backend, "")
    if env_var:
        env_key = os.environ.get(env_var)
        if env_key:
            return env_key
    for config_path in [
        os.path.join(os.path.expanduser("~"), ".dcresource", "config.json"),
        os.path.join(os.path.dirname(_THIS_DIR), ".dcresource_config.json"),
    ]:
        if os.path.exists(config_path):
            try:
                with open(config_path, encoding="utf-8") as f:
                    cfg = json.load(f)
                key = cfg.get("api_key") or cfg.get("anthropic_api_key") or cfg.get("dashscope_api_key")
                if key:
                    return key
            except (json.JSONDecodeError, OSError):
                continue
    return None


def main():
    ap = argparse.ArgumentParser(
        description="Extract data center resource planning parameters from equipment photos using AI vision.",
        epilog="Pipe to resource_plan.py:  python image_recognize.py photo.jpg | python resource_plan.py",
    )
    ap.add_argument("image_path", help="Path to image file (JPEG/PNG/WebP)")
    ap.add_argument("--api-key", help="API key (overrides backend-specific env var)")
    ap.add_argument("--model", default=None,
                    help="Model ID (default: backend-dependent, see --backend)")
    ap.add_argument("--interactive", "-i", action="store_true",
                    help="Review and edit extracted data before output")
    ap.add_argument("--output", "-o", help="Save output JSON to file (in addition to stdout)")
    ap.add_argument("--verbose", "-V", action="store_true",
                    help="Show progress messages on stderr")
    ap.add_argument("--backend", default="claude", choices=["claude", "qwen"],
                    help="AI vision backend (default: claude, also: qwen)")
    ap.add_argument("--version", action="version", version="image_recognize.py 1.0.0")
    args = ap.parse_args()

    # Set default model based on backend if not explicitly given
    if args.model is None:
        args.model = BACKEND_DEFAULT_MODELS.get(args.backend, "qwen-vl-max")

    # 1. Validate image file
    if not os.path.isfile(args.image_path):
        print(f"Error: file not found: {args.image_path}", file=sys.stderr)
        sys.exit(1)

    # 2. Resolve API key
    api_key = _resolve_api_key(args)
    if not api_key:
        env_var = BACKEND_ENV_VARS.get(args.backend, "API_KEY")
        print(f"Error: No API key found for backend '{args.backend}'.", file=sys.stderr)
        print(f"  Set {env_var} environment variable,", file=sys.stderr)
        print(f"  pass --api-key, or create ~/.dcresource/config.json.", file=sys.stderr)
        sys.exit(1)

    # 3. Initialize backend
    try:
        backend = get_backend(args.backend, api_key=api_key, model=args.model)
    except Exception as e:
        print(f"Error initializing backend: {e}", file=sys.stderr)
        sys.exit(1)

    if args.verbose:
        print(f"[{backend.name}] Analyzing: {args.image_path}", file=sys.stderr)

    # 4. Call recognition
    try:
        result = backend.recognize(args.image_path, SYSTEM_PROMPT)
    except Exception as e:
        print(f"Error during recognition: {e}", file=sys.stderr)
        sys.exit(1)

    if args.verbose:
        print(f"[Raw response {len(result.raw_response)} chars]", file=sys.stderr)
        for w in result.warnings:
            print(f"[Warn] {w}", file=sys.stderr)

    # 5. Parse response
    data = result.parsed
    if data is None:
        print("Error: Could not parse JSON from AI response.", file=sys.stderr)
        print(f"Raw response:\n{result.raw_response[:2000]}", file=sys.stderr)
        sys.exit(1)

    # 6. Check for explicit error from AI
    if "error" in data:
        print(f"AI reported: {data['error']}", file=sys.stderr)
        sys.exit(1)

    # 7. Schema validation
    is_valid, warnings = validate_input(data)
    if warnings:
        for w in warnings:
            print(f"Warning: {w}", file=sys.stderr)

    # 8. Interactive editing
    if args.interactive:
        data = interactive_edit(data)
        _, warnings = validate_input(data)
        if warnings:
            for w in warnings:
                print(f"Note: {w}", file=sys.stderr)

    # 9. Output
    output_json = json.dumps(data, ensure_ascii=False, indent=2)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output_json)
        if args.verbose:
            print(f"Saved to: {args.output}", file=sys.stderr)

    print(output_json)


if __name__ == "__main__":
    main()
