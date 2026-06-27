#!/usr/bin/env python3
"""Disable Bitwarden server notification startup for EBvault mandatory 2FA stability."""

from __future__ import annotations

import re
import sys
from pathlib import Path

MARKER = "EBvault disable server notifications during mandatory 2FA flow"

DISABLE_BODY = f"""    // {MARKER}: /notifications/hub is not available in this deployment.
    // Never let SignalR/WebSocket startup block login, 2FA, or mandatory setup navigation.
    console.warn("[EBvault 2FA] server notifications disabled during mandatory 2FA flow");
    return;
"""

ASYNC_DISABLE_BODY = f"""    // {MARKER}: /notifications/hub is not available in this deployment.
    // Never let SignalR/WebSocket startup block login, 2FA, or mandatory setup navigation.
    console.warn("[EBvault 2FA] server notifications disabled during mandatory 2FA flow");
    return Promise.resolve();
"""

DEBUG_PATTERNS = ("HubConnection", ".start(", "start(", "reconnect", "WebSocket", "SignalR")


def patch_void_method(text: str, method_name: str) -> tuple[str, bool]:
    pattern = re.compile(
        rf"(?P<header>^\s*(?:(?:public|private|protected)\s+)?{re.escape(method_name)}\s*\([^)]*\)\s*(?::\s*void\s*)?\{{\n)",
        re.MULTILINE,
    )
    match = pattern.search(text)
    if not match:
        return text, False

    insert_at = match.end()
    if MARKER in text[insert_at : insert_at + 500]:
        return text, True

    return text[:insert_at] + DISABLE_BODY + text[insert_at:], True


def patch_async_start_method(text: str) -> tuple[str, bool]:
    patterns = []
    for method_name in ("start", r"start\$", "connect", "startConnection", "connectToHub"):
        patterns.extend(
            [
                re.compile(
                    rf"(?P<header>^\s*(?:(?:public|private|protected)\s+)?async\s+{method_name}\s*\([^)]*\)\s*(?::\s*Promise<[^>]+>\s*)?\{{\n)",
                    re.MULTILINE,
                ),
                re.compile(
                    rf"(?P<header>^\s*(?:(?:public|private|protected)\s+)?{method_name}\s*\([^)]*\)\s*:\s*Promise<[^>]+>\s*\{{\n)",
                    re.MULTILINE,
                ),
                re.compile(
                    rf"(?P<header>^\s*(?:(?:public|private|protected)\s+)?{method_name}\s*\([^)]*\)\s*(?::\s*void\s*)?\{{\n)",
                    re.MULTILINE,
                ),
            ]
        )

    for pattern in patterns:
        match = pattern.search(text)
        if not match:
            continue
        insert_at = match.end()
        if MARKER in text[insert_at : insert_at + 500]:
            return text, True
        header = match.group("header")
        body = ASYNC_DISABLE_BODY if "Promise<" in header or "async " in header else DISABLE_BODY
        return text[:insert_at] + body + text[insert_at:], True

    return text, False


def dump_signalr_matches(path: Path, text: str) -> None:
    print(f"  Searching {path.name} for:")
    for pattern in DEBUG_PATTERNS:
        print(f"  - {pattern}")

    lines = text.splitlines()
    found = False
    for index, line in enumerate(lines, start=1):
        if any(pattern in line for pattern in DEBUG_PATTERNS):
            found = True
            start = max(1, index - 2)
            end = min(len(lines), index + 2)
            print(f"  {path}:{index}: {line.rstrip()}")
            for nearby_index in range(start, end + 1):
                if nearby_index == index:
                    continue
                print(f"    {nearby_index}: {lines[nearby_index - 1].rstrip()}")

    if not found:
        print(f"  WARNING: no SignalR debug patterns found in {path}")


def patch_direct_hub_start_call(text: str) -> tuple[str, bool]:
    if MARKER in text:
        return text, True

    lines = text.splitlines(keepends=True)
    for index, line in enumerate(lines):
        lower = line.lower()
        if ".start(" not in line:
            continue
        if "connection" not in lower and "hub" not in lower and "signalr" not in lower:
            continue

        indent = line[: len(line) - len(line.lstrip())]
        replacement = (
            f"{indent}// {MARKER}: direct SignalR startup call disabled.\n"
            f'{indent}console.warn("[EBvault 2FA] server notifications disabled during mandatory 2FA flow");\n'
            f"{indent}return;\n"
        )
        lines[index] = replacement
        return "".join(lines), True

    return text, False


def patch_default_server_notifications(path: Path, clients_dir: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    patched_any = False

    for method in ("reconnectFromActivity", "connect", "start", "startListening"):
        text, patched = patch_void_method(text, method)
        patched_any = patched_any or patched

    if not patched_any:
        raise RuntimeError(f"{path}: could not find reconnectFromActivity/connect method to disable")

    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"  disabled server notification reconnect in {path.relative_to(clients_dir)}")
        return True

    print(f"  server notification reconnect already disabled in {path.name}")
    return False


def patch_signalr_connection(path: Path, clients_dir: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    dump_signalr_matches(path.relative_to(clients_dir), text)

    text, patched = patch_async_start_method(text)
    if not patched:
        text, patched = patch_direct_hub_start_call(text)
    if not patched:
        print(
            f"  WARNING: {path.relative_to(clients_dir)}: could not find a SignalR start method/call to disable"
        )
        return False

    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"  disabled SignalR connection start in {path.relative_to(clients_dir)}")
        return True

    print(f"  SignalR connection start already disabled in {path.name}")
    return False


def main() -> int:
    clients_dir = Path(sys.argv[1])
    if not clients_dir.is_dir():
        raise SystemExit(f"ERROR: clients directory not found: {clients_dir}")

    default_paths = list(clients_dir.rglob("default-server-notifications.service.ts"))
    signalr_paths = list(clients_dir.rglob("signalr-connection.service.ts"))

    if not default_paths:
        raise SystemExit("ERROR: could not find default-server-notifications.service.ts")
    if not signalr_paths:
        print("  WARNING: could not find signalr-connection.service.ts; high-level notifications remain disabled")
        signalr_paths = []

    for path in default_paths:
        patch_default_server_notifications(path, clients_dir)
    for path in signalr_paths:
        patch_signalr_connection(path, clients_dir)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
