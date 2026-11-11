# ClawGod Blue

[English](#english) · [中文](#clawgod-blue) · [介绍页](https://pengzzzzz1.github.io/clawgod-blue/)

蓝色 Claude Code 运行时。本地补丁、功能解锁、隐私中和、网安任务总览。

**作者：** [Dingfire](https://github.com/pengzzzzz1)（`pengzzzzz1`）  
**上游：** [0Chencc/clawgod](https://github.com/0Chencc/clawgod)（GPL-3.0）  
**本仓库：** 开源储蓄库，公开可克隆、可改、可装。

> 这不是第三方 Claude Code 客户端。ClawGod Blue 下载官方 Claude Code，在本地打补丁后替换 `claude` 启动器。蓝色 Logo = 已补丁；橙色 Logo = 原版。

## 这是什么

ClawGod Blue 是我维护的 **Claude Code 蓝色工作区版**：

1. **运行时补丁** — 解锁内部命令、Agent Teams、Auto-mode、Computer Use 等被订阅/firstParty 门挡住的能力。
2. **蓝色身份** — 品牌色 `#3B82F6`。`clawgod --blue-status` 核验主题补丁是否真正命中，不是改个图标交差。
3. **网安任务总览** — `clawgod --security` 给审计 / 事件 / 复测项目做「目标 → 步骤 → 证据 → 结果」台账。
4. **隐私中和** — 挡住日期隐写、地区探针、`wiggly-dove` 对 Git origin 和环境的采集。
5. **Completions 管线** — 可走 OpenAI 兼容接口（DeepSeek 等），不绑死 Anthropic Messages。

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

| 块 | 内容 |
|---|---|
| 功能解锁 | 24+ 隐藏命令、GrowthBook 覆盖、Agent Teams、Auto-mode、Ultraplan / Ultrareview |
| 限制拆除 | 安全测试拒答提示、URL 禁猜、破坏性操作强确认、企业远程设置门 |
| 蓝色主题 | 暗色主色 `rgb(59,130,246)`，`clawgod --blue-status` 必须 `verified` |
| 任务总览 | `audit` / `incident` / `retest` 三套模板，证据 SHA256，Markdown 报告 |
| 隐私 | 地理隐写中和、`x-claude-code-wiggly-dove` 采集阻断 |

```powershell
clawgod --security init audit --title "订单 API 审计" --objective "检查对象级访问控制"
clawgod --security start
clawgod --security report
```

## 构建与自检

```powershell
node build.js
node build.js --check
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
