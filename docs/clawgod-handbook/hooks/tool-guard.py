#!/usr/bin/env python3
"""
ClawGod Handbook — PreToolUse Guard Hook
Claude Code PreToolUse hook

功能：
  1. 对 Bash/Write/Edit 工具调用做风险判定
  2. ALLOW / CONFIRM / BLOCK；宽松场景只降级 CONFIRM
  3. 全部决策写入审计日志

安装：
  cp tool-guard.py ~/.claude/hooks/tool-guard.py
  chmod +x ~/.claude/hooks/tool-guard.py

配置（~/.claude/settings.json）：
  {
    "hooks": {
      "PreToolUse": [
        { "matcher": "Bash|Write|Edit", "hooks": [{ "type": "command", "command": "python ~/.claude/hooks/tool-guard.py", "timeout": 3 }] }
      ]
    }
  }

行为：
  - AUDIT_ONLY = True（复仇号版默认）：任何判定都只写审计日志，一律放行。
    BLOCK/CONFIRM 规则仍在 evaluate_block 中保留并记录原判定，供事后审计；
    需要恢复拦截时把 AUDIT_ONLY 改为 False。
  - AUDIT_ONLY = False 时：
    ALLOW：正常放行，退出码 0
    BLOCK：阻断工具调用，退出码 2，stderr 输出原因
    CONFIRM：通过 permissionDecision=ask 请求确认，退出码 0

  注意：Claude Code PreToolUse hook 的阻断使用退出码 2。
  CTF/渗透测试目录内 CONFIRM 降为放行，BLOCK 始终阻断。
  如需更严格的控制，修改下方 BLOCK_RULES。
"""

import json
import ntpath
import posixpath
import re
import sys
from pathlib import Path
from datetime import datetime

# ═══════════════════════════════════════════════════════════
# 配置区
# ═══════════════════════════════════════════════════════════

# 复仇号版：守卫只审计、不拦截。False 恢复 BLOCK/CONFIRM 行为。
AUDIT_ONLY = True

# 审计日志目录
LOG_DIR = Path.home() / ".claude" / "audit"

# ── BLOCK 规则：无条件阻断 ──
# 格式：(工具名列表, 正则模式, 原因)
BLOCK_RULES = [
    # 文件系统破坏
    (["Bash"], r"rm\s+(-\w*f\w*\s+)?/($|\s)", "破坏性操作：rm -rf /"),
    (["Bash"], r"mkfs\b", "破坏性操作：mkfs"),
    (["Bash"], r"dd\s+.*of=/dev/", "破坏性操作：dd 写入设备"),

    # 系统文件写入
    (["Write", "Edit"], r"^[A-Z]:/(Windows|Program Files(?: \(x86\))?|boot)(?:/|$)", "系统目录写入"),
    (["Write", "Edit"], r"^/(etc|boot|usr|System|EFI)(?:/|$)", "系统目录写入"),
    (["Write", "Edit"], r"/etc/(passwd|shadow|hosts|fstab)(?:/|$)", "关键系统文件"),

    # 凭据窃取
    (["Bash"], r"(mimikatz|secretsdump|hashdump)", "凭据窃取工具"),

    # 大规模无差别扫描
    (["Bash"], r"masscan\s+.*0\.0\.0\.0/0", "全网段扫描"),
    (["Bash"], r"nmap\s+.*-p-\s+.*\d+\.\d+\.\d+\.\d+/\d{2}", "全端口大范围扫描"),
]

# ── CONFIRM 规则：普通场景请求确认，宽松场景记录并放行 ──
CONFIRM_PATTERNS = [
    # 网络扫描（非 localhost）
    r"(nmap|masscan|rustscan)\s+(?!.*127\.0\.0\.1)(?!.*localhost)",
    # 二进制执行
    r"\./\w+\.(elf|bin)",
    r"python\s+\w*(exploit|poc)",
]

# ── 场景感知：CTF/渗透测试场景下放宽 CONFIRM → ALLOW ──
RELAXED_SCENE_KEYWORDS = ["ctf", "CTF", "pentest", "redteam", "靶场"]

# ═══════════════════════════════════════════════════════════
# 核心逻辑
# ═══════════════════════════════════════════════════════════

def classify_target(command: str) -> str:
    """从命令中判断目标类型"""
    if not command:
        return "unknown"
    if re.search(r"(127\.0\.0\.1|localhost)", command):
        return "localhost"
    if re.search(r"(192\.168|10\.\d|172\.(1[6-9]|2\d|3[01]))\.", command):
        return "private_network"
    return "general"


def is_relaxed_scene(cwd: str) -> bool:
    """判断当前是否在宽松场景（CTF/渗透测试）"""
    if not cwd:
        return False
    parts = re.split(r"[/\\]+", cwd)
    for part in parts:
        if part.lower() in [k.lower() for k in RELAXED_SCENE_KEYWORDS]:
            return True
    return False


def normalize_file_path(file_path: str, cwd: str = "") -> str:
    """Normalize path syntax without accessing or resolving files on disk."""
    windows = bool(ntpath.splitdrive(file_path)[0] or ntpath.splitdrive(cwd)[0] or "\\" in file_path)
    if windows:
        path = file_path.replace("/", "\\")
        if path.startswith("\\\\?\\"):
            path = path[4:]
        path = ntpath.normpath(ntpath.join(cwd, path))
        return path.replace("\\", "/")
    return posixpath.normpath(posixpath.join(cwd, file_path))


def evaluate_block(tool_name: str, tool_input: dict, cwd: str = "") -> tuple:
    """
    评估是否应阻断。
    返回 (action, reason, risk)
    action: "allow" | "confirm" | "block"
    """
    # Bash 工具检查
    if tool_name == "Bash":
        command = tool_input.get("command", "")
        for tools, pattern, reason in BLOCK_RULES:
            if tool_name in tools and re.search(pattern, command, re.IGNORECASE):
                return "block", reason, "critical"

        # CONFIRM 级检查
        for pattern in CONFIRM_PATTERNS:
            if re.search(pattern, command, re.IGNORECASE):
                if is_relaxed_scene(cwd):
                    return "allow", "confirm→allow(relaxed)", "medium"
                return "confirm", "Tool invocation requires confirmation", "medium"

        return "allow", "", "low"

    # Write 和 Edit 对同一个路径使用相同规则。
    if tool_name in ("Write", "Edit"):
        file_path = normalize_file_path(tool_input.get("file_path", ""), cwd)
        for tools, pattern, reason in BLOCK_RULES:
            if tool_name in tools and re.search(pattern, file_path, re.IGNORECASE):
                return "block", reason, "critical"
        return "allow", "", "low"

    # 其他工具默认放行
    return "allow", "", "low"


def log_decision(session_id: str, tool_name: str, tool_input: dict,
                 action: str, reason: str, risk: str, cwd: str):
    """写入审计日志"""
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        date_str = datetime.now().strftime("%Y-%m-%d")
        log_file = LOG_DIR / f"tool-guard-{date_str}.jsonl"

        entry = {
            "ts": datetime.now().isoformat(),
            "session_id": session_id,
            "layer": "tool-guard",
            "tool": tool_name,
            "command": (tool_input.get("command", "")[:200]
                        if tool_name == "Bash"
                        else tool_input.get("file_path", "")[:200]),
            "target": classify_target(tool_input.get("command", "")),
            "risk": risk,
            "action": action,
            "reason": reason,
            "cwd": cwd,
        }

        with open(log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def main():
    # Hook JSON and diagnostics use UTF-8 even on legacy Windows code pages.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    try:
        raw = sys.stdin.buffer.read().decode("utf-8-sig") if hasattr(sys.stdin, "buffer") else sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, UnicodeDecodeError):
        # 坏输入不构成拦截理由：记录后放行（AUDIT_ONLY 下 hook 永不 exit 2）。
        print("[Guard] Invalid hook input JSON; allowing (audit-only)", file=sys.stderr)
        sys.exit(0)

    if not isinstance(data, dict) or not isinstance(data.get("tool_input", {}), dict) or any(
        key in data and not isinstance(data[key], str)
        for key in ("tool_name", "session_id", "cwd")
    ) or any(
        key in data.get("tool_input", {}) and not isinstance(data["tool_input"][key], str)
        for key in ("command", "file_path")
    ):
        print("[Guard] Invalid hook input fields; allowing (audit-only)", file=sys.stderr)
        sys.exit(0)

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})
    session_id = data.get("session_id", "")
    cwd = data.get("cwd", "")

    action, reason, risk = evaluate_block(tool_name, tool_input, cwd)

    # 复仇号版：原判定进审计日志，动作一律放行。
    if AUDIT_ONLY and action in ("block", "confirm"):
        reason = f"audit-only (upstream verdict: {action}) {reason}".strip()
        action = "allow"

    # 审计日志
    log_decision(session_id, tool_name, tool_input, action, reason, risk, cwd)

    if action == "block":
        # 阻断：退出码 2，stderr 输出原因
        print(f"[Guard BLOCK] {reason}", file=sys.stderr)
        sys.exit(2)
    elif action == "confirm":
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": reason,
        }}, ensure_ascii=True))
    else:
        # 放行：退出码 0
        if reason:
            print(f"[Guard] {tool_name}: {reason} (risk={risk})", file=sys.stderr)
        sys.exit(0)


if __name__ == "__main__":
    main()
