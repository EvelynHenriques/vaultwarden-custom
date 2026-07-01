#!/usr/bin/env python3
"""Improve EBcofre contrast for light nudge cards."""

from __future__ import annotations

import sys
from pathlib import Path

LEGACY_MARKER = "EBcofre readable soft callout foreground"
MARKER = "EBcofre readable light nudge card"
READABLE_LIGHT_CARD_TEXT = "!tw-text-gray-900"


def restore_callout_if_needed(clients_dir: Path) -> None:
    callout = clients_dir / "libs/components/src/callout/callout.component.ts"
    if not callout.is_file():
        return

    text = callout.read_text(encoding="utf-8")
    if LEGACY_MARKER not in text:
        return

    legacy = f"""  protected readonly fgClass = computed(() => {{
    switch (this.type()) {{
      case "danger":
        return "!tw-text-fg-danger-strong";
      case "info":
        // {LEGACY_MARKER}: soft EBcofre cards use a light background, so use dark text.
        return "!tw-text-fg-heading";
      case "success":
        return "!tw-text-fg-heading";
      case "warning":
        return "!tw-text-fg-warning-strong";
      case "subtle":
        return "!tw-text-fg-heading";
    }}
  }});"""

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

    if legacy in text:
        callout.write_text(text.replace(legacy, original, 1), encoding="utf-8")
        print("  restored upstream callout foreground behavior")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    if not path.is_file():
        raise SystemExit(f"ERROR: {label} not found: {path}")

    text = path.read_text(encoding="utf-8")
    if MARKER in text:
        updated = text.replace("!tw-text-green-950", READABLE_LIGHT_CARD_TEXT)
        if updated != text:
            path.write_text(updated, encoding="utf-8")
            print(f"  updated EBcofre {label} contrast to dark readable text")
            return
        print(f"  EBcofre contrast patch already present in {label}")
        return

    if old not in text:
        raise SystemExit(f"ERROR: expected {label} block not found: {path}")

    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"  improved EBcofre {label} contrast")


def patch_generator_nudge(clients_dir: Path) -> None:
    path = clients_dir / "libs/tools/generator/components/src/nudge-generator-spotlight.component.html"
    old = '  <div class="tw-mb-4">'
    new = (
        f'  <div class="tw-mb-4 [&_aside]:{READABLE_LIGHT_CARD_TEXT} '
        f'[&_header]:{READABLE_LIGHT_CARD_TEXT} [&_p]:{READABLE_LIGHT_CARD_TEXT} '
        f'[&_button]:{READABLE_LIGHT_CARD_TEXT}" data-ebcofre-contrast="{MARKER}">'
    )
    replace_once(path, old, new, "generator nudge")


def patch_new_item_nudge(clients_dir: Path) -> None:
    path = clients_dir / "libs/vault/src/cipher-form/components/new-item-nudge/new-item-nudge.component.html"
    old = '  <bit-callout [title]="nudgeTitle" [icon]="null" (dismiss)="dismissNewItemSpotlight()">'
    new = (
        f'  <bit-callout class="[&_aside]:{READABLE_LIGHT_CARD_TEXT} '
        f'[&_header]:{READABLE_LIGHT_CARD_TEXT} [&_a]:{READABLE_LIGHT_CARD_TEXT}" '
        f'data-ebcofre-contrast="{MARKER}" '
        f'[title]="nudgeTitle" [icon]="null" (dismiss)="dismissNewItemSpotlight()">'
    )
    replace_once(path, old, new, "new-item nudge")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: apply-ebcofre-contrast-patch.py <clients-dir>", file=sys.stderr)
        return 2

    clients_dir = Path(sys.argv[1])
    restore_callout_if_needed(clients_dir)
    patch_generator_nudge(clients_dir)
    patch_new_item_nudge(clients_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
