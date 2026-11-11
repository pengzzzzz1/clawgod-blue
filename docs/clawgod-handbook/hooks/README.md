# Hooks — 可直接运行的脚本

> 复制到 `~/.claude/hooks/` 即可使用，无需手写代码。

---

## 包含文件

| 文件 | 对应层 | 触发时机 | 功能 |
|------|--------|----------|------|
| `scene-router.py` | Layer 2 | UserPromptSubmit | cwd 预设匹配 + 关键词匹配 → 动态注入场景上下文 |
| `tool-guard.py` | Layer 3 | PreToolUse | Bash/Write/Edit 工具调用风险评估 → allow/ask/block |
| `setup.sh` | — | 安装时 | 一键安装 hook 脚本 + 注册到 settings.json（macOS/Linux） |
| `setup.ps1` | — | 安装时 | 一键安装（Windows） |
| `setup_hooks.py` | — | 安装时 | 两个平台共用的配置合并、旧配置迁移和 UTF-8 原子写入 |
| `test_hooks.py` | — | 测试时 | 无外部依赖的回归测试，使用临时用户目录 |

---

## 快速安装

### macOS / Linux

```bash
cd clawgod-handbook/hooks
bash setup.sh
```

### Windows (PowerShell)

```powershell
cd clawgod-handbook\hooks
.\setup.ps1
```

安装脚本会自动：
1. 复制 hook 脚本到 `~/.claude/hooks/`
2. 注册 hook 到 `~/.claude/settings.json`
3. 安装 `security-research-context.md` rules（如果不存在）
4. 创建审计日志目录 `~/.claude/audit/`

安装器需要 Python 3，使用找到的解释器绝对路径注册 hook。路径包含空格、单引号或中文也可使用。重复安装不会增加重复条目，旧版平铺的 `command` 条目会迁移为 `hooks` 数组格式；同组中的其他 hook 保留。损坏的 JSON、无效的 hook 配置结构或符号链接形式的 settings.json 会报错中止，保留原文件；使用 dotfiles 链接时按下方格式手动合并。Windows 读入旧 BOM 配置后按 UTF-8 无 BOM 写回。

## 手动安装

如果不想用安装脚本：

```bash
# 1. 复制脚本
mkdir -p ~/.claude/hooks
cp scene-router.py tool-guard.py ~/.claude/hooks/
```

编辑 `~/.claude/settings.json`，将以下内容合并到已有配置。示例适用于 POSIX shell；Windows 的安装器会生成解释器及脚本的完整路径。`timeout` 的单位是秒。

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "python3 \"$HOME/.claude/hooks/scene-router.py\"", "timeout": 3 }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit",
        "hooks": [
          { "type": "command", "command": "python3 \"$HOME/.claude/hooks/tool-guard.py\"", "timeout": 3 }
        ]
      }
    ]
  }
}
```

重启 Claude Code 后生效。Scene Router 输出 `hookSpecificOutput.additionalContext`，不会回写或替换用户 prompt。没有命中场景时不向 stdout 输出内容。

## 卸载

```bash
# macOS / Linux
bash setup.sh --uninstall

# Windows
.\setup.ps1 -Uninstall
```

卸载只移除这两个已安装脚本对应的 hook 注册和脚本文件，保留其他 hook、rules 和审计日志。若配置文件损坏，先修复 JSON，再执行卸载。

---

## 自定义

### scene-router.py

编辑脚本顶部的配置区：

```python
# 添加新的目录映射
CWD_MAP = {
    "my-project": "my-custom-scene",
    ...
}

# 添加新的场景上下文
SCENE_CONTEXT = {
    "my-custom-scene": "[场景识别] 你的自定义场景描述...",
    ...
}
```

### tool-guard.py

Write 和 Edit 共用系统路径规则，规范化 Windows 的分隔符、盘符和 `..`，也检查相对当前工作目录的目标路径。BLOCK 不受场景影响；CONFIRM 在普通目录返回 `permissionDecision: "ask"`，在 `ctf`、`pentest` 等已配置目录中按原设计降级为 allow，并记录实际决策。此规则集仍是有限模式匹配，不是完整命令解释器或文件系统沙箱。

编辑 `BLOCK_RULES` 列表添加新的阻断规则：

```python
BLOCK_RULES = [
    (["Bash"], r"your-dangerous-pattern", "原因说明"),
    ...
]
```

---

## 审计日志

所有决策记录在 `~/.claude/audit/` 目录下：

```
~/.claude/audit/
├── scene-router-2026-05-13.jsonl    # 场景识别日志
└── tool-guard-2026-05-13.jsonl      # 工具守卫日志
```

每行一条 JSON，格式参见 [audit-log-schema.md](../appendix/audit-log-schema.md)。

## 回归验证

```bash
python -B test_hooks.py
```

测试在临时用户目录内运行，覆盖启动、hook 输出协议、路径判断、确认分支、旧配置迁移、幂等安装卸载和损坏配置保留。Windows 执行 PowerShell 包装器，POSIX 执行 shell 包装器；不适用的平台用例跳过。
