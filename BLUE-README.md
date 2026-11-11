# ClawGod Blue · 网安任务总览版

蓝色 Claude 角色，加上“目标、步骤、证据、结果”的项目总览。基于已经修复的 ClawGod 源码构建。

## 蓝色代表什么

角色、品牌文字与加载动画采用蓝色。暗色终端主色为 `#3b82f6`，浅色主题用更深的蓝色，ANSI 终端使用蓝色回退。错误、警告、成功等状态色各自保留。

```powershell
clawgod --blue-status
clawgod --blue-status --json
```

`verified` 表示角色主题补丁有实际匹配、主题源码 SHA256 与补丁完成后的记录一致，并且主题开关已启用。`disabled` 表示主题已关闭，`stale` 表示源码有变化，`unverified` 表示没有可核验的蓝色角色，`invalid` 表示记录或配置无效。仅 `verified` 退出 0。

蓝色角色证明蓝色主题已加载；它不是模型能力、所有功能或任务执行结果的证明。

## Windows 安装

需要 Node.js 和兼容的 Bun。解压本源码包，在包目录运行本地安装脚本：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
clawgod --blue-status
```

已有完整 ClawGod 安装时，可复用已保存的原始源码：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -NoUpgrade
```

安装器会下载或提取官方客户端，向用户目录写入运行时，并调整 `claude`/`clawgod` 启动器。交付源码包本身不会自动安装。Blue 使用独立的本地版本流程；升级或重新应用时运行此包的安装器。普通 `claude update` 会给出本地升级提示，避免覆盖成上游绿色版本。

Linux/macOS 使用 `bash ./install.sh`；本轮实机验证在 Windows 完成，其他平台未做完整安装测试。

## 项目总览

进入实际项目目录，然后创建任务：

```powershell
clawgod --security init audit --title "订单 API 审计" --objective "检查订单读取与修改的访问控制"
clawgod --security status
clawgod --security start
```

支持三种模板：`audit` 代码审计、`incident` 日志与事件分析、`retest` 漏洞复测。`start` 启动 Claude 会话，并附加当前目标、步骤、证据元数据和结果。工作指引要求会话按真实执行情况维护项目记录；模型能否正确执行仍需检查记录与证据。

```powershell
clawgod --security step S01 done --note "已确认代码版本与接口范围"
clawgod --security step S02 running
clawgod --security step add "检查对象级访问控制"
clawgod --security evidence ".\artifacts\retest-response.txt" --note "修复后复测响应"
clawgod --security finding "订单对象访问控制问题" --severity high --evidence E001 --note "复现与修复情况见证据"
clawgod --security resolve F001 fixed --note "修复后复测符合预期"
clawgod --security status --json
clawgod --security report
```

上述标题和文件为用法示例，应替换为项目实际情况。记录在 `.clawgod-security/`，可从项目子目录继续操作。证据复制后记录 SHA256、大小和原名；每次总览/报告重新核验副本。报告默认生成新 Markdown 文件，现有文件不会被覆盖。项目指引保存在 `WORKFLOW.md`，不覆盖已有 `CLAUDE.md`。

尚未安装时也可用 Node 在源码上体验本地总览，将 `clawgod` 换成：

```powershell
node C:\实际路径\clawgod-blue\src\shared\cli.cjs --security init audit --title "测试项目"
```

本地总览命令无需模型密钥。`start` 需要已经安装并配置模型服务的运行时。`start` 支持追加普通 Claude 参数，例如 `--print "根据总览继续工作"`；现有 `--append-system-prompt` 会保留并合并。

## 构建、测试、回退

```powershell
node scripts/verify.mjs
```

卸载使用同一源码包的本地安装器：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
```

卸载恢复原启动器并清理 Blue 运行时；项目中的 `.clawgod-security/` 保留。源码增量补丁和回退脚本随交付物提供，作用于源码而非已安装客户端。

详细命令见 [任务总览说明](docs/blue-workspace.md)。
