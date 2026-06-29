#!/usr/bin/env python3
"""Improve EBvault contrast for soft callout/nudge cards."""

from __future__ import annotations

import sys
from pathlib import Path

MARKER = "EBvault readable soft callout foreground"


def patch_callout(clients_dir: Path) -> None:
    callout = clients_dir / "libs/components/src/callout/callout.component.ts"
    if not callout.is_file():
        raise SystemExit(f"ERROR: callout component not found: {callout}")

    text = callout.read_text(encoding="utf-8")
    if MARKER in text:
        print("  EBvault contrast patch already present")
        return

    original = """  protected readonly fgClass = computed(() => {
    switch (this.type()) {
      case "danger":
        return "!tw-text-fg-danger-strong";
      case "info":
        return "!tw-text-fg-brand-strong";
      case "success":
        return "!tw-text-fg-success-strong";
      case "warning":
        return "!tw-text-fg-warning-strong";
      case "subtle":
        return "!tw-text-fg-heading";
    }
  });"""

    replacement = f"""  protected readonly fgClass = computed(() => {{
    switch (this.type()) {{
      case "danger":
        return "!tw-text-fg-danger-strong";
      case "info":
        // {MARKER}: soft EBvault cards use a light background, so use dark text.
        return "!tw-text-fg-heading";
      case "success":
        return "!tw-text-fg-heading";
      case "warning":
        return "!tw-text-fg-warning-strong";
      case "subtle":
        return "!tw-text-fg-heading";
    }}
  }});"""

    if original not in text:
        raise SystemExit(f"ERROR: expected callout foreground block not found: {callout}")

    callout.write_text(text.replace(original, replacement, 1), encoding="utf-8")
    print("  improved EBvault soft callout foreground contrast")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: apply-ebvault-contrast-patch.py <clients-dir>", file=sys.stderr)
        return 2

    clients_dir = Path(sys.argv[1])
    patch_callout(clients_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
