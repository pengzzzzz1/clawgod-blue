# ClawGod Blue

[English](#english) · [中文](#clawgod-blue) · [介绍页](https://pengzzzzz1.github.io/clawgod-blue/)

蓝色 Claude Code 运行时。本地补丁、功能解锁、隐私中和、网安任务总览。

**作者：** [Dingfire](https://github.com/pengzzzzz1)（`pengzzzzz1`）  
**上游：** [0Chencc/clawgod](https://github.com/0Chencc/clawgod)（GPL-3.0）  
**本仓库：** 开源储蓄库，公开可克隆、可改、可装。

> 这不是第三方 Claude Code 客户端。ClawGod Blue 下载官方 Claude Code，在本地打补丁后替换 `claude` 启动器。蓝色 Logo = 已补丁；橙色 Logo = 原版。

## 这是什么

ClawGod Blue 是我维护的 **Claude Code 蓝色工作区版**。可开关能力以 `src/shared/patch.mjs` 的 `FEATURES` 为准（`clawgod --features`）。Blue 发行额外带：

1. **蓝色身份** — `BLUE_THEME_PALETTE.dark` = `rgb(59,130,246)`。`clawgod --blue-status` 核主题源码 SHA256。
2. **网安任务总览** — `clawgod --security`：目标 → 步骤 → 证据 SHA256 → 结果。
3. **Completions 管线** — `provider.json` `protocol=openai-chat` 走 OpenAI 兼容接口。

详细命令见 [BLUE-README.md](BLUE-README.md)。手册见 [docs/clawgod-handbook](docs/clawgod-handbook/README.md)。

## 安装

需要 Node.js ≥ 18、ripgrep。Bun 缺失时安装器会尝试自装。

```powershell
git clone https://github.com/pengzzzzz1/clawgod-blue.git
cd clawgod-blue
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
clawgod --blue-status
```

macOS / Linux：

```bash
git clone https://github.com/pengzzzzz1/clawgod-blue.git
cd clawgod-blue
bash ./install.sh
clawgod --blue-status
```

已有完整安装、只想重打补丁：

```powershell
.\install.ps1 -NoUpgrade
```

卸载同一脚本：`.\install.ps1 -Uninstall`

启动请用 `~\.local\bin\claude.cmd`（或 `clawgod`），不要直接跑 `claude.orig.exe`。

## 能干什么

能力清单不手写。安装后：

```powershell
clawgod --features
clawgod --features --json
```

输出就是 `src/shared/patch.mjs` 里的 `FEATURES` 注册表（id、desc、patchIds）。落地页由 `node web/render-landing.mjs` 从同一份 catalog 生成。Blue 发行在补丁之外还有：`--blue-status`、`--security`、`openai-chat` 代理、`--lean-on|off|max`。

```powershell
clawgod --security init audit --title "订单 API 审计" --objective "检查对象级访问控制"
clawgod --security start
clawgod --security report
```

## 构建与自检

```powershell
node build.js
node build.js --check
node web/render-landing.mjs --check
node --test src/shared/blue-theme.test.mjs src/shared/blue-status.test.mjs src/shared/blue-cli.test.mjs src/shared/security-workspace.test.mjs
```

## 许可证与致谢

GPL-3.0。补丁器源自 [0Chencc/clawgod](https://github.com/0Chencc/clawgod)。本仓库是 Dingfire 的 Blue 工作区发行：蓝色主题、任务总览、本地安装器。贡献请看 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## English

ClawGod Blue is a **local runtime patcher** for official Claude Code: unlock hidden features, paint the client blue, keep a security-workspace ledger, and neutralize known geo / Git telemetry. It is **not** a third-party client.

```powershell
git clone https://github.com/pengzzzzz1/clawgod-blue.git
cd clawgod-blue
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
clawgod --blue-status
```

Blue logo = patched. Orange logo = stock. License: GPL-3.0. Upstream: [0Chencc/clawgod](https://github.com/0Chencc/clawgod). Maintainer: [Dingfire](https://github.com/pengzzzzz1).
