#!/usr/bin/env python3
"""Offline regression tests; all hook/installer side effects use a temporary home."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


scene = load("scene-router")
guard = load("tool-guard")
setup = load("setup_hooks")


class HooksTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="clawgod hook test ")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / "captain's project \u6d4b\u8bd5"
        self.home.mkdir()
        self.env = dict(os.environ, USERPROFILE=str(self.home), HOME=str(self.home), PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")

    def run_hook(self, name, payload):
        data = payload if isinstance(payload, str) else json.dumps(payload)
        return subprocess.run([sys.executable, "-B", str(HERE / (name + ".py"))],
                              input=data, text=True, encoding="utf-8", capture_output=True, env=self.env, timeout=10)

    def test_scene_empty_input_starts_without_name_error(self):
        result = self.run_hook("scene-router", {})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")

    def test_scene_uses_additional_context_not_prompt_replacement(self):
        result = self.run_hook("scene-router", {"cwd": "C:\\work\\AuDiT\\project", "prompt": "keep my exact prompt", "session_id": "test"})
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(set(output), {"hookSpecificOutput"})
        self.assertEqual(output["hookSpecificOutput"], {
            "hookEventName": "UserPromptSubmit", "additionalContext": scene.SCENE_CONTEXT["code-audit"],
        })
        log = next((self.home / ".claude/audit").glob("scene-router-*.jsonl"))
        self.assertTrue(json.loads(log.read_text(encoding="utf-8"))["context_injected"])

    def test_scene_keyword_duplicates_do_not_inflate_confidence(self):
        self.assertEqual(scene.match_keywords("CTF"), ("security-research", 0.5))
        self.assertEqual(scene.match_cwd("/work/CTF/test"), ("ctf-competition", 1.0))
        self.assertEqual(scene.match_cwd("C:\\work\\ctf-extra"), (None, 0.0))

    def test_real_utf8_hook_bytes_ignore_windows_console_encoding(self):
        env = dict(self.env, PYTHONUTF8="0")
        env.pop("PYTHONIOENCODING", None)
        for encoding in (None, "gbk"):
            if encoding is not None:
                env["PYTHONIOENCODING"] = encoding
            for name, payload in (
                ("scene-router", {"cwd": "C:/projects", "prompt": "漏洞分析", "session_id": "中文"}),
                ("tool-guard", {"tool_name": "Write", "tool_input": {"file_path": "C:/Windows/配置.txt"}, "cwd": "C:/projects"}),
            ):
                with self.subTest(name=name, encoding=encoding):
                    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                    result = subprocess.run([sys.executable, "-B", str(HERE / (name + ".py"))],
                                            input=raw, capture_output=True, env=env, timeout=10)
                    if name == "scene-router":
                        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8"))
                        context = json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]
                        self.assertEqual(context, scene.SCENE_CONTEXT["security-research"])
                    else:
                        self.assertEqual(result.returncode, 2)
                        self.assertIn("系统目录写入", result.stderr.decode("utf-8"))

    def test_invalid_utf8_input_has_a_defined_result(self):
        for name, exit_code in (("scene-router", 0), ("tool-guard", 2)):
            result = subprocess.run([sys.executable, "-B", str(HERE / (name + ".py"))],
                                    input=b'{"prompt":"\xff"}', capture_output=True, env=self.env, timeout=10)
            self.assertEqual(result.returncode, exit_code)
            self.assertEqual(result.stdout, b"")
            self.assertIn("Invalid hook input JSON", result.stderr.decode("utf-8"))

    def test_malformed_scene_input_never_echoes_untrusted_stdout(self):
        for payload in ("{broken", "[]", '{"prompt":[]}', '{"cwd":null}'):
            with self.subTest(payload=payload):
                result = self.run_hook("scene-router", payload)
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertIn("Invalid hook input", result.stderr)

    def test_guard_windows_paths_and_edit_share_policy(self):
        paths = [r"C:\Windows\fixture.txt", "c:/windows/fixture.txt", r"C:\work\..\Windows\fixture.txt",
                 r"\\?\C:\Windows\fixture.txt", "C:/Program Files/App/config", "C:/Program Files (x86)/App/config"]
        for tool in ("Write", "Edit"):
            for path in paths:
                with self.subTest(tool=tool, path=path):
                    self.assertEqual(guard.evaluate_block(tool, {"file_path": path})[0], "block")
            self.assertEqual(guard.evaluate_block(tool, {"file_path": "../Windows/fixture.txt"}, "C:/work")[0], "block")
            self.assertEqual(guard.evaluate_block(tool, {"file_path": "/etc/fixture.txt"})[0], "block")
            self.assertEqual(guard.evaluate_block(tool, {"file_path": "C:/WindowsProject/a.py"})[0], "allow")
            self.assertEqual(guard.evaluate_block(tool, {"file_path": "src/a.py"}, "C:/project")[0], "allow")

    def test_guard_confirmation_uses_cwd_and_never_relaxes_blocks(self):
        payload = {"tool_name": "Bash", "tool_input": {"command": "nmap 192.0.2.1"}, "cwd": "C:/projects"}
        result = self.run_hook("tool-guard", payload)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)["hookSpecificOutput"]
        self.assertEqual(output["hookEventName"], "PreToolUse")
        self.assertEqual(output["permissionDecision"], "ask")
        payload["cwd"] = "C:/ctf/project"
        result = self.run_hook("tool-guard", payload)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertIn("relaxed", result.stderr)
        payload["tool_input"]["command"] = "rm -rf /"
        result = self.run_hook("tool-guard", payload)
        self.assertEqual(result.returncode, 2)
        self.assertIn("Guard BLOCK", result.stderr)

    def test_guard_malformed_input_is_blocked(self):
        for payload in ("{broken", "[]", '{"tool_input":[]}', '{"tool_input":{"command":[]}}'):
            with self.subTest(payload=payload):
                result = self.run_hook("tool-guard", payload)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, "")

    def test_install_uninstall_preserves_other_hooks_and_is_idempotent(self):
        settings = self.home / ".claude/settings.json"
        hooks = settings.parent / "hooks"
        settings.parent.mkdir()
        old_scene = {"command": 'python "' + str(hooks / "scene-router.py") + '"', "timeout": 3000}
        old_guard = {"type": "command", "command": 'python "' + str(hooks / "tool-guard.py") + '"'}
        unrelated = {"type": "command", "command": "echo keep-me", "timeout": 12}
        same_filename = {"type": "command", "command": "python /another/project/tool-guard.py"}
        initial = {"theme": "dark", "description": "中文配置", "hooks": {
            "UserPromptSubmit": [old_scene],
            "PreToolUse": [{"matcher": "Write", "hooks": [old_guard, unrelated, same_filename]}],
            "Stop": [{"hooks": [unrelated]}],
        }}
        settings.write_text(json.dumps(initial), encoding="utf-8-sig")
        setup.install(self.home, HERE)
        first = settings.read_bytes()
        self.assertFalse(first.startswith(b"\xef\xbb\xbf"))
        actual = json.loads(first)
        self.assertEqual(actual["description"], initial["description"])
        self.assertEqual(actual["hooks"]["Stop"], initial["hooks"]["Stop"])
        self.assertEqual(actual["hooks"]["PreToolUse"][0], {"matcher": "Write", "hooks": [unrelated, same_filename]})
        self.assertEqual(actual["hooks"]["PreToolUse"][1]["matcher"], "Bash|Write|Edit")
        self.assertEqual(actual["hooks"]["UserPromptSubmit"][0]["hooks"][0]["timeout"], 3)
        setup.install(self.home, HERE)
        self.assertEqual(settings.read_bytes(), first)
        setup.install(self.home, HERE, uninstall=True)
        after = json.loads(settings.read_bytes())
        self.assertNotIn("UserPromptSubmit", after["hooks"])
        self.assertEqual(after["hooks"]["PreToolUse"], [{"matcher": "Write", "hooks": [unrelated, same_filename]}])
        self.assertFalse((hooks / "tool-guard.py").exists())
        self.assertTrue((settings.parent / "rules/security-research-context.md").exists())
        setup.install(self.home, HERE, uninstall=True)
        self.assertEqual(json.loads(settings.read_bytes()), after)

    def test_invalid_configuration_never_changes_files(self):
        settings = self.home / ".claude/settings.json"
        script = self.home / ".claude/hooks/tool-guard.py"
        script.parent.mkdir(parents=True)
        script.write_text("original script", encoding="utf-8")
        for content in ('{broken', '[]', '{"hooks":[]}', '{"hooks":{"PreToolUse":{}}}', '{"hooks":{"PreToolUse":[{"hooks":{}}]}}'):
            for uninstall in (False, True):
                with self.subTest(content=content, uninstall=uninstall):
                    settings.write_text(content, encoding="utf-8")
                    with self.assertRaises(ValueError):
                        setup.install(self.home, HERE, uninstall)
                    self.assertEqual(settings.read_text(encoding="utf-8"), content)
                    self.assertEqual(script.read_text(encoding="utf-8"), "original script")

    def test_versioned_python_commands_are_owned_but_other_scripts_are_not(self):
        destination = self.home / ".claude/hooks/tool-guard.py"
        self.assertTrue(setup.is_managed_hook({"command": 'python3.12 "' + str(destination) + '"'}, destination))
        self.assertFalse(setup.is_managed_hook({"command": 'echo "' + str(destination) + '"'}, destination))
        self.assertFalse(setup.is_managed_hook({"command": 'python "/other/tool-guard.py"'}, destination))

    def test_missing_source_does_not_write_configuration(self):
        missing = self.home / "missing"
        missing.mkdir()
        with self.assertRaises(ValueError):
            setup.install(self.home, missing)
        self.assertFalse((self.home / ".claude").exists())

    def test_settings_symlinks_are_rejected_without_writing(self):
        settings = self.home / ".claude/settings.json"
        target = self.home / 'dotfiles.json'
        target.write_text('{"keep":true}', encoding='utf-8')
        settings.parent.mkdir()
        try:
            settings.symlink_to(target)
        except OSError:
            # Standard Windows accounts may lack symlink creation privileges.
            with patch.object(Path, 'is_symlink', return_value=True):
                with self.assertRaisesRegex(ValueError, 'symlink'):
                    setup.install(self.home, HERE)
            self.assertFalse(settings.exists())
        else:
            for uninstall in (False, True):
                with self.assertRaisesRegex(ValueError, 'symlink'):
                    setup.install(self.home, HERE, uninstall)
                self.assertTrue(settings.is_symlink())
            target.unlink()
            with self.assertRaisesRegex(ValueError, 'symlink'):
                setup.install(self.home, HERE)
            target.write_text('{"keep":true}', encoding='utf-8')
        self.assertEqual(target.read_text(encoding='utf-8'), '{"keep":true}')
        self.assertFalse((settings.parent / 'hooks').exists())

    @unittest.skipUnless(os.name == "nt" and shutil.which("powershell.exe"), "Windows PowerShell wrapper")
    def test_powershell_wrapper_real_install_and_uninstall(self):
        cmd = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(HERE / "setup.ps1")]
        env = dict(self.env, PATH=str(Path(sys.executable).parent) + os.pathsep + self.env.get("PATH", ""))
        for extra in ([], [], ["-Uninstall"], ["-Uninstall"]):
            result = subprocess.run(cmd + extra, env=env, text=True, encoding="utf-8", capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads((self.home / ".claude/settings.json").read_bytes()), {})

    @unittest.skipUnless(os.name != "nt" and shutil.which("bash"), "POSIX shell wrapper")
    def test_shell_wrapper_real_install_and_uninstall(self):
        for extra in ([], [], ["--uninstall"], ["--uninstall"]):
            result = subprocess.run(["bash", str(HERE / "setup.sh"), *extra], env=self.env,
                                    text=True, encoding="utf-8", capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads((self.home / ".claude/settings.json").read_bytes()), {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
