#!/usr/bin/env python3
"""Disable server notifications at the high-level service only."""

from __future__ import annotations

import re
import sys
from pathlib import Path

MARKER = "EBvault disable server notifications during mandatory 2FA flow"
WARNING = '(globalThis as any).EBVAULT_2FA_DEBUG === true && console.warn("[EBvault 2FA] server notifications disabled during mandatory 2FA flow");'

EBVAULT_BLOCK_RE = re.compile(
    rf"\n[ \t]*// {re.escape(MARKER)}[^\n]*\n"
    rf"(?:[ \t]*// Never let SignalR/WebSocket startup block login, 2FA, or mandatory setup navigation\.\n)?"
    rf"[ \t]*{re.escape(WARNING)}\n"
    rf"[ \t]*return(?: EMPTY| Promise\.resolve\(\))?;\n",
)


def add_empty_import(text: str) -> str:
    rxjs_import = re.search(
        r'import\s+\{(?P<names>[^}]*)\}\s+from\s+"rxjs";',
        text,
        re.DOTALL,
    )
    if rxjs_import:
        names = [name.strip() for name in rxjs_import.group("names").split(",") if name.strip()]
        if "EMPTY" not in names:
            names.append("EMPTY")
            replacement = f'import {{ {", ".join(names)} }} from "rxjs";'
            text = text[: rxjs_import.start()] + replacement + text[rxjs_import.end() :]
        return text

    return 'import { EMPTY } from "rxjs";\n' + text


def method_return_kind(header: str) -> str:
    normalized = " ".join(header.split())
    if "Observable<" in normalized:
        return "observable"
    if "Promise<" in normalized or normalized.startswith("async "):
        return "promise"
    return "void"


def disable_body(indent: str, kind: str) -> str:
    if kind == "observable":
        return (
            f"{indent}// {MARKER}: /notifications/hub is not available in this deployment.\n"
            f"{indent}// Never let SignalR/WebSocket startup block login, 2FA, or mandatory setup navigation.\n"
            f"{indent}{WARNING}\n"
            f"{indent}return EMPTY;\n"
        )
    if kind == "promise":
        return (
            f"{indent}// {MARKER}: /notifications/hub is not available in this deployment.\n"
            f"{indent}// Never let SignalR/WebSocket startup block login, 2FA, or mandatory setup navigation.\n"
            f"{indent}{WARNING}\n"
            f"{indent}return Promise.resolve();\n"
        )
    return (
        f"{indent}// {MARKER}: /notifications/hub is not available in this deployment.\n"
        f"{indent}// Never let SignalR/WebSocket startup block login, 2FA, or mandatory setup navigation.\n"
        f"{indent}{WARNING}\n"
        f"{indent}return;\n"
    )


def patch_method(text: str, method_name: str) -> tuple[str, bool, bool]:
    pattern = re.compile(
        rf"(?P<header>^(?P<indent>[ \t]*)(?:(?:public|private|protected)\s+)?(?:async\s+)?"
        rf"{re.escape(method_name)}\s*\([^)]*\)\s*(?::\s*[^{{}};=]*)?\{{\n)",
        re.MULTILINE,
    )
    match = pattern.search(text)
    if not match:
        return text, False, False

    insert_at = match.end()
    already_patched = MARKER in text[insert_at : insert_at + 500]
    if already_patched:
        return text, True, method_return_kind(match.group("header")) == "observable"

    kind = method_return_kind(match.group("header"))
    text = text[:insert_at] + disable_body(match.group("indent") + "  ", kind) + text[insert_at:]
    return text, True, kind == "observable"


def patch_default_server_notifications(path: Path, clients_dir: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    original = text
    patched_any = False
    needs_empty = False

    for method in (
        "reconnectFromActivity",
        "connect$",
        "connect",
        "start$",
        "start",
        "startListening",
    ):
        text, patched, method_needs_empty = patch_method(text, method)
        patched_any = patched_any or patched
        needs_empty = needs_empty or method_needs_empty

    if not patched_any:
        raise RuntimeError(
            f"{path}: could not find a high-level server notification start/reconnect method"
        )

    if needs_empty:
        text = add_empty_import(text)

    if text != original:
        path.write_text(text, encoding="utf-8")
        print(f"  disabled server notifications in {path.relative_to(clients_dir)}")
        return True

    print(f"  server notifications already disabled in {path.relative_to(clients_dir)}")
    return False


def clean_signalr_connection(path: Path, clients_dir: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    cleaned = EBVAULT_BLOCK_RE.sub("", text)
    if cleaned == text:
        print(f"  left SignalR connection untouched in {path.relative_to(clients_dir)}")
        return False

    path.write_text(cleaned, encoding="utf-8")
    print(f"  removed stale EBvault SignalR patch from {path.relative_to(clients_dir)}")
    return True


def main() -> int:
    clients_dir = Path(sys.argv[1])
    if not clients_dir.is_dir():
        raise SystemExit(f"ERROR: clients directory not found: {clients_dir}")

    default_paths = list(clients_dir.rglob("default-server-notifications.service.ts"))
    if not default_paths:
        raise SystemExit("ERROR: could not find default-server-notifications.service.ts")

    for path in default_paths:
        patch_default_server_notifications(path, clients_dir)

    for path in clients_dir.rglob("signalr-connection.service.ts"):
        clean_signalr_connection(path, clients_dir)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
