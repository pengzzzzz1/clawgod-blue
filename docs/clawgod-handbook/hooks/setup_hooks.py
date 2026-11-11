#!/usr/bin/env python3
"""Shared, idempotent hook installation for the shell and PowerShell wrappers."""

import argparse
import copy
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile


HOOKS = {"UserPromptSubmit": "scene-router.py", "PreToolUse": "tool-guard.py"}


def read_settings(path):
    if path.is_symlink():
        raise ValueError("settings.json is a symlink; edit its hook configuration manually")
    if not path.exists():
        return {}
    try:
        settings = json.loads(path.read_text(encoding="utf-8-sig"))
    except (ValueError, OSError) as exc:
        raise ValueError("Cannot read settings.json; existing configuration was not changed") from exc
    if not isinstance(settings, dict):
        raise ValueError("settings.json must contain a JSON object")
    hooks = settings.get("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError("settings.hooks must be an object")
    for event in HOOKS:
        entries = hooks.get(event, [])
        if not isinstance(entries, list) or any(not isinstance(entry, dict) for entry in entries):
            raise ValueError("Invalid hook entries for " + event)
        for entry in entries:
            if "hooks" in entry and (not isinstance(entry["hooks"], list) or any(
                not isinstance(hook, dict) for hook in entry["hooks"]
            )):
                raise ValueError("Invalid nested hooks for " + event)
    return settings


def is_managed_hook(hook, destination):
    command = hook.get("command")
    if not isinstance(command, str):
        return False
    # Match the script argument, not its filename appearing in arbitrary text.
    try:
        args = shlex.split(command, posix=os.name != "nt")
    except ValueError:
        return False
    expected = str(destination).replace("\\", "/")
    legacy = "~/.claude/hooks/" + destination.name
    for value in args[1:]:
        value = value.strip("\"'").replace("\\", "/")
        if os.name == "nt":
            value, expected, legacy = value.casefold(), expected.casefold(), legacy.casefold()
        if value in (expected, legacy):
            interpreter = args[0].strip("\"'").replace("\\", "/").rsplit("/", 1)[-1].lower()
            return bool(re.fullmatch(r"(?:python(?:\d+(?:\.\d+)*)?|py)(?:\.exe)?", interpreter))
    return False


def merge_settings(settings, hooks_dir, uninstall=False, python=None):
    updated = copy.deepcopy(settings)
    hooks = updated.setdefault("hooks", {})
    for event, filename in HOOKS.items():
        destination = hooks_dir / filename
        kept = []
        for entry in hooks.get(event, []):
            if is_managed_hook(entry, destination):
                continue  # Migrate the former flat registration format.
            if "hooks" in entry:
                remaining = [hook for hook in entry["hooks"] if not is_managed_hook(hook, destination)]
                if remaining:
                    kept.append(dict(entry, hooks=remaining))
                elif not entry["hooks"]:
                    kept.append(entry)
            else:
                kept.append(entry)
        if not uninstall:
            args = [python or sys.executable, str(destination)]
            command = subprocess.list2cmdline(args) if os.name == "nt" else shlex.join(args)
            registration = {"hooks": [{"type": "command", "command": command, "timeout": 3}]}
            if event == "PreToolUse":
                registration["matcher"] = "Bash|Write|Edit"
            kept.append(registration)
        if kept:
            hooks[event] = kept
        else:
            hooks.pop(event, None)
    if not hooks:
        updated.pop("hooks", None)
    return updated


def write_settings(path, settings):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                         dir=path.parent, prefix=".settings-", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(settings, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        if path.exists():
            os.chmod(temporary, path.stat().st_mode)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def install(home, source, uninstall=False):
    root = home / ".claude"
    settings_path, hooks_dir = root / "settings.json", root / "hooks"
    # Validate before copying/removing scripts or touching settings.
    original = read_settings(settings_path)
    updated = merge_settings(original, hooks_dir, uninstall)
    if uninstall:
        if updated != original:
            write_settings(settings_path, updated)
        for filename in HOOKS.values():
            path = hooks_dir / filename
            if path.exists():
                path.unlink()
        return
    for filename in HOOKS.values():
        if not (source / filename).is_file():
            raise ValueError("Missing hook source: " + filename)
    hooks_dir.mkdir(parents=True, exist_ok=True)
    for filename in HOOKS.values():
        destination = hooks_dir / filename
        if (source / filename).resolve() != destination.resolve():
            shutil.copyfile(source / filename, destination)
        if os.name != "nt":
            destination.chmod(destination.stat().st_mode | 0o100)
    if updated != original:
        write_settings(settings_path, updated)
    rule = source.parent / "01-session-rules/security-research-context.md"
    rule_dst = root / "rules/security-research-context.md"
    if rule.is_file() and not rule_dst.exists():
        rule_dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(rule, rule_dst)
    (root / "audit").mkdir(parents=True, exist_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uninstall", action="store_true")
    args = parser.parse_args()
    try:
        install(Path.home(), Path(__file__).resolve().parent, args.uninstall)
    except (ValueError, OSError) as exc:
        print("[clawgod-hooks] " + str(exc), file=sys.stderr)
        return 1
    print("[clawgod-hooks] " + ("Uninstalled" if args.uninstall else "Installed") + " scene-router and tool-guard")
    return 0


if __name__ == "__main__":
    sys.exit(main())
