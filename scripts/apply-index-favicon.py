#!/usr/bin/env python3
"""Idempotently apply EBvault favicon and title to apps/web/src/index.html."""

from __future__ import annotations

import re
import sys
from pathlib import Path

FAVICON_BLOCK = """    <link rel="apple-touch-icon" href="images/icons/logo-shield.svg" />
    <link rel="icon" type="image/svg+xml" href="images/icons/logo-shield.svg" />
    <link rel="mask-icon" href="images/icons/logo-shield.svg" color="#556b2f" />"""


def apply_index_html(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text

    if not re.search(r"<!doctype\s+html>", text, re.IGNORECASE):
        raise RuntimeError(f"{path}: missing <!doctype html> — refusing to modify")

    if "<app-root" not in text:
        raise RuntimeError(f"{path}: missing <app-root> — refusing to modify")

    text = re.sub(r"<title[^>]*>.*?</title>", "<title>EBvault</title>", text, count=1, flags=re.DOTALL)

    text = re.sub(r"\s*<link[^>]*rel=[\"']apple-touch-icon[\"'][^>]*>\s*", "\n", text)
    text = re.sub(r"\s*<link[^>]*rel=[\"']icon[\"'][^>]*>\s*", "\n", text)
    text = re.sub(r"\s*<link[^>]*rel=[\"']mask-icon[\"'][^>]*>\s*", "\n", text)

    has_svg_favicon = re.search(
        r"<link[^>]*rel=[\"']icon[\"'][^>]*href=[\"']images/icons/logo-shield\.svg[\"'][^>]*>",
        text,
    )
    if not has_svg_favicon:
        text = text.replace(
            '<link rel="manifest" href="manifest.json" />',
            FAVICON_BLOCK + '\n    <link rel="manifest" href="manifest.json" />',
            1,
        )

    if "favicon-32x32.png" in text or "favicon-16x16.png" in text or "apple-touch-icon.png" in text:
        raise RuntimeError(f"{path}: old PNG favicon references remain after patch")

    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"  updated EBvault title/favicon in {path.name}")
        return True

    print(f"  index.html already has EBvault favicon/title")
    return False


def main() -> int:
    clients_dir = Path(sys.argv[1])
    index_path = clients_dir / "apps/web/src/index.html"
    if not index_path.is_file():
        raise SystemExit(f"ERROR: missing {index_path}")
    apply_index_html(index_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
