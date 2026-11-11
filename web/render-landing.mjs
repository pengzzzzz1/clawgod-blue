#!/usr/bin/env node
/**
 * Generate repo-root index.html from src/shared/patch.mjs --catalog.
 * Feature names on the page are the registry, not marketing copy.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATCHER = join(ROOT, 'src/shared/patch.mjs');
const OUT = join(ROOT, 'index.html');
const CHECK = process.argv.includes('--check');

const dumped = spawnSync(process.execPath, [PATCHER, '--catalog'], { encoding: 'utf8' });
if (dumped.status !== 0) {
  process.stderr.write(dumped.stderr || 'patch.mjs --catalog failed\n');
  process.exit(1);
}
const catalog = JSON.parse(dumped.stdout);
if (catalog.edition !== 'clawgod-blue' || !Array.isArray(catalog.features)) {
  throw new Error('invalid catalog');
}

const GROUPS = [
  { title: 'Runtime gates', ids: ['agent-teams', 'computer-use', 'ultraplan', 'ultrareview', 'voice-mode', 'auto-mode', 'classifier-tuning'] },
  { title: 'Prompt / policy', ids: ['cyber-risk', 'url-restriction', 'cautious-actions', 'not-logged-in', 'message-filter', 'remote-settings'] },
  { title: 'Telemetry', ids: ['geo-neutralize', 'wiggly-dove'] },
  { title: 'Theme', ids: ['theme'] },
];
const grouped = new Set(GROUPS.flatMap((g) => g.ids));
const leftover = catalog.features.filter((f) => !grouped.has(f.id));
if (leftover.length) GROUPS.push({ title: 'Other registry entries', ids: leftover.map((f) => f.id) });
const byId = Object.fromEntries(catalog.features.map((f) => [f.id, f]));
for (const g of GROUPS) {
  for (const id of g.ids) {
    if (!byId[id]) throw new Error('landing group references unknown feature: ' + id);
  }
}

const core = catalog.patches.filter((p) => !p.toggleable);
const toggle = catalog.patches.filter((p) => p.toggleable);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const featureCards = (ids) => ids.map((id) => {
  const f = byId[id];
  return `<article class="card">
      <div class="id">${esc(f.id)}</div>
      <div class="desc">${esc(f.desc)}</div>
      <div class="pids">${f.patchIds.map((p) => `<code>${esc(p)}</code>`).join(' ')}</div>
    </article>`;
}).join('\n    ');

const coreRows = core.map((p) => `<tr>
        <td><code>${esc(p.id)}</code></td>
        <td>${esc(p.name)}</td>
        <td>${p.ast ? 'AST' : 'regex'}${p.optional ? ' · optional' : ''}</td>
      </tr>`).join('\n      ');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ClawGod Blue — local runtime patcher for Claude Code</title>
  <meta name="description" content="ClawGod Blue 从 src/shared/patch.mjs 的 FEATURES 注册表生成能力清单。官方 Claude Code 本地补丁，clawd_body → rgb(59,130,246)。" />
  <link rel="icon" href="clawd-blue.png" />
  <style>
    :root {
      --blue: #3b82f6;
      --blue-bright: #60a5fa;
      --blue-deep: #1d4ed8;
      --blue-glow: rgba(59,130,246,.18);
      --bg: #0a0a0a;
      --surface: #111;
      --surface-2: #161616;
      --border: #1f1f1f;
      --border-hi: #2a2a2a;
      --text: #e8e8e8;
      --text-2: #b4b4b4;
      --dim: #737373;
      --ok: #67e8c8;
      --sans: "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      --mono: "Cascadia Code", "JetBrains Mono", ui-monospace, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--sans); }
    body { min-height: 100vh; }
    a { color: var(--blue-bright); text-decoration: none; }
    a:hover { text-decoration: underline; text-underline-offset: 3px; }
    code { font-family: var(--mono); font-size: .85em; color: var(--blue-bright); }
    .wrap { width: min(1080px, calc(100% - 40px)); margin: 0 auto; }
    .topbar { position: sticky; top: 0; z-index: 5; backdrop-filter: blur(12px); background: rgba(10,10,10,.82); border-bottom: 1px solid var(--border); }
    .topbar-inner { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; }
    .brand { font-family: var(--mono); font-weight: 700; letter-spacing: -.04em; color: var(--text); text-decoration: none; }
    .brand em { color: var(--blue); font-style: normal; }
    .topbar nav { display: flex; gap: 18px; font-size: 13px; color: var(--dim); }
    .topbar nav a { color: var(--text-2); }
    .hero { text-align: center; padding: 72px 0 28px; }
    .pill { display: inline-flex; align-items: center; gap: 8px; font-family: var(--mono); font-size: 12px; color: var(--text-2); border: 1px solid var(--border); background: var(--surface); border-radius: 999px; padding: 6px 12px; }
    .pill i { width: 6px; height: 6px; border-radius: 50%; background: var(--blue); box-shadow: 0 0 8px var(--blue); }
    h1 { font-size: clamp(42px, 8vw, 72px); letter-spacing: -.06em; margin: 18px 0 8px; font-weight: 750; }
    h1 span { color: var(--blue); }
    .tag { color: var(--text-2); font-size: 18px; margin: 0 0 10px; }
    .sub { color: var(--dim); font-size: 14px; line-height: 1.65; max-width: 46em; margin: 0 auto; }
    .hero-links { display: flex; justify-content: center; gap: 10px; margin-top: 22px; flex-wrap: wrap; }
    .btn { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 16px; border-radius: 8px; border: 1px solid var(--border-hi); color: var(--text); background: var(--surface); font-size: 14px; font-weight: 600; }
    .btn:hover { text-decoration: none; border-color: var(--blue); }
    .btn.primary { background: var(--blue); border-color: var(--blue); color: #fff; }
    .install { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin: 8px 0 28px; }
    .tabs { display: flex; border-bottom: 1px solid var(--border); }
    .tabs button { flex: 1; background: transparent; color: var(--text-2); border: 0; padding: 12px; font-family: var(--mono); font-size: 12px; cursor: pointer; }
    .tabs button.active { color: var(--blue-bright); background: var(--surface-2); }
    .panel { display: none; position: relative; }
    .panel.active { display: block; }
    .panel pre { margin: 0; padding: 18px 18px 20px; overflow: auto; font-family: var(--mono); font-size: 13px; line-height: 1.7; color: var(--text); }
    .prompt { color: var(--blue); }
    .copy { position: absolute; top: 10px; right: 10px; background: var(--bg); color: var(--text-2); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; font-size: 11px; font-family: var(--mono); cursor: pointer; }
    .note { padding: 0 18px 14px; font-size: 12px; color: var(--dim); font-family: var(--mono); }
    .shot { margin: 0 auto 8px; border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: #111827; }
    .shot img { width: 100%; display: block; }
    .caption { text-align: center; color: var(--dim); font-family: var(--mono); font-size: 12px; margin: 10px 0 36px; }
    .sq { color: var(--blue); }
    .section { padding: 48px 0; border-top: 1px solid var(--border); }
    .head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: baseline; margin-bottom: 22px; }
    .head h2 { margin: 0; font-size: 22px; }
    .head h2 .n { font-family: var(--mono); color: var(--blue); font-size: 14px; margin-right: 8px; font-weight: 500; }
    .head p { margin: 0; color: var(--dim); font-family: var(--mono); font-size: 13px; max-width: 42em; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
    .card .id { font-family: var(--mono); font-size: 13px; color: var(--blue-bright); margin-bottom: 6px; }
    .card .desc { font-size: 13px; color: var(--text-2); line-height: 1.5; }
    .card .pids { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px; }
    .card .pids code { font-size: 10px; color: var(--dim); }
    .table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border); }
    th { font-family: var(--mono); font-size: 11px; color: var(--dim); font-weight: 600; background: var(--surface); }
    tr:last-child td { border-bottom: 0; }
    .how { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
    .how article { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
    .how h3 { margin: 0 0 8px; font-size: 15px; }
    .how p { margin: 0; color: var(--text-2); font-size: 13px; line-height: 1.55; }
    footer { border-top: 1px solid var(--border); padding: 22px 0 48px; color: var(--dim); font-size: 12px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    footer a { color: var(--text-2); }
    @media (max-width: 720px) {
      .topbar nav { display: none; }
      h1 { font-size: 40px; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="wrap topbar-inner">
      <a class="brand" href="https://github.com/pengzzzzz1/clawgod-blue">claw<span>god</span> <em>blue</em></a>
      <nav>
        <a href="#features">FEATURES</a>
        <a href="#core">core patches</a>
        <a href="#install">install</a>
        <a href="https://github.com/pengzzzzz1/clawgod-blue">GitHub</a>
      </nav>
    </div>
  </header>

  <main class="wrap">
    <section class="hero">
      <div class="pill"><i></i> FEATURES 来自 <code>src/shared/patch.mjs</code> · ${esc(String(catalog.features.length))} 项可开关 · ${esc(String(catalog.patches.length))} 条补丁</div>
      <h1>claw<span>god</span> <span>blue</span></h1>
      <p class="tag">官方 Claude Code 的本地补丁运行时。</p>
      <p class="sub">不是换皮客户端。安装器拉取官方包，按注册表改 <code>cli.js</code>，再用 <code>~\\.local\\bin\\claude.cmd</code> 启动。下面的能力名、补丁 id、主题色都从源码导出，落地页禁止手写第二份清单。</p>
      <div class="hero-links">
        <a class="btn primary" href="#install">Install</a>
        <a class="btn" href="https://github.com/pengzzzzz1/clawgod-blue">Source</a>
        <a class="btn" href="https://github.com/0Chencc/clawgod">Upstream 0Chencc/clawgod</a>
      </div>
    </section>

    <section id="install" class="install">
      <div class="tabs" role="tablist">
        <button class="active" data-t="win" type="button">Windows</button>
        <button data-t="unix" type="button">macOS / Linux</button>
      </div>
      <div class="panel active" id="panel-win">
        <button class="copy" data-copy="git clone https://github.com/pengzzzzz1/clawgod-blue.git&#10;cd clawgod-blue&#10;powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\install.ps1&#10;clawgod --blue-status&#10;clawgod --features">Copy</button>
        <pre><span class="prompt">PS&gt;</span> git clone https://github.com/pengzzzzz1/clawgod-blue.git
<span class="prompt">PS&gt;</span> cd clawgod-blue
<span class="prompt">PS&gt;</span> powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\install.ps1
<span class="prompt">PS&gt;</span> clawgod --blue-status
<span class="prompt">PS&gt;</span> clawgod --features</pre>
        <div class="note">启动器用 ~\\.local\\bin\\claude.cmd。不要跑 claude.orig.exe。蓝色 Logo = 已补丁。</div>
      </div>
      <div class="panel" id="panel-unix">
        <button class="copy" data-copy="git clone https://github.com/pengzzzzz1/clawgod-blue.git&#10;cd clawgod-blue&#10;bash ./install.sh&#10;clawgod --blue-status&#10;clawgod --features">Copy</button>
        <pre><span class="prompt">$</span> git clone https://github.com/pengzzzzz1/clawgod-blue.git
<span class="prompt">$</span> cd clawgod-blue
<span class="prompt">$</span> bash ./install.sh
<span class="prompt">$</span> clawgod --blue-status
<span class="prompt">$</span> clawgod --features</pre>
        <div class="note">Linux/macOS 安装器随源码提供。Node ≥ 18，ripgrep；Bun 缺失时安装器会尝试自装。</div>
      </div>
    </section>

    <figure class="shot">
      <img src="welcome-hero.png" alt="官方 Claude Code 欢迎屏。Clawd 的 clawd_body 已由 theme-logo-rgb 写成 rgb(59,130,246)。" />
    </figure>
    <p class="caption"><span class="sq">█</span> ${esc(catalog.palette.dark)} = <code>BLUE_THEME_PALETTE.dark</code> / <code>theme-logo-rgb</code> 写入 <code>clawd_body</code></p>

    ${GROUPS.map((g, i) => `<section class="section" ${i === 0 ? 'id="features"' : ''}>
      <div class="head">
        <h2><span class="n">${String(i + 1).padStart(2, '0')}</span>${esc(g.title)}</h2>
        <p>id 与 desc 原样取自 FEATURES。卡片上的 code 是该 feature 绑定的 patchIds。</p>
      </div>
      <div class="grid">
    ${featureCards(g.ids)}
      </div>
    </section>`).join('\n')}

    <section class="section" id="core">
      <div class="head">
        <h2><span class="n">${String(GROUPS.length + 1).padStart(2, '0')}</span>Core patches</h2>
        <p>无 toggleable 标记 = 安装时必打，不进 patches.json。共 ${esc(String(core.length))} 条；可开关 ${esc(String(toggle.length))} 条。</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>id</th><th>name</th><th>matcher</th></tr></thead>
          <tbody>
      ${coreRows}
          </tbody>
        </table>
      </div>
    </section>

    <section class="section">
      <div class="head">
        <h2><span class="n">${String(GROUPS.length + 2).padStart(2, '0')}</span>Blue 发行附加命令</h2>
        <p>这些入口在 <code>src/shared/cli.cjs</code> / <code>blue-status.cjs</code> / <code>security-workspace.cjs</code>，不是 FEATURES 表里的补丁。</p>
      </div>
      <div class="grid">
        <article class="card"><div class="id">--blue-status</div><div class="desc">对照 blue-patch-state.json 与主题源码 SHA256。仅 verified 退出 0。不代表全部功能已验证。</div><div class="pids"><code>blue-status.cjs</code></div></article>
        <article class="card"><div class="id">--features</div><div class="desc">打印本页同一份 FEATURES 注册表。加 --json 输出 catalog。</div><div class="pids"><code>cli.cjs</code> <code>patch.mjs --catalog</code></div></article>
        <article class="card"><div class="id">--security</div><div class="desc">audit / incident / retest 项目台账：步骤、证据 SHA256、发现项、Markdown 报告。记录在 .clawgod-security/。</div><div class="pids"><code>security-workspace.cjs</code></div></article>
        <article class="card"><div class="id">openai-chat</div><div class="desc">provider.json protocol=openai-chat 时启动 Completions 代理：Anthropic Messages → Chat Completions，前置 workspace contract，JSON/SSE 拒答自动续写。</div><div class="pids"><code>openai-proxy.cjs</code></div></article>
        <article class="card"><div class="id">redline-strip</div><div class="desc">启动时 hook fetch，剥离 system 里的安全/拒答段落、EndConversation 工具，分类器强制 ALLOW，并注入 workspace contract。CLAWGOD_REDLINE=0 可关。</div><div class="pids"><code>redline-strip.cjs</code></div></article>
        <article class="card"><div class="id">--lean-on / --lean-off / --lean-max</div><div class="desc">改 ~/.claude/settings.json 的精简档，用户其它设置保留。</div><div class="pids"><code>lean-settings.cjs</code></div></article>
      </div>
    </section>

    <section class="section" id="how">
      <div class="head">
        <h2><span class="n">∞</span>How it works</h2>
        <p>两段运行时补丁。不 fork，不编译官方客户端。</p>
      </div>
      <div class="how">
        <article><h3>Extract</h3><p>安装器读取官方包，抽出 <code>cli.js</code> 与嵌入的 <code>.node</code>，按 Bun 落盘执行做后处理。</p></article>
        <article><h3>Patch</h3><p><code>patch.mjs</code> 先跑 AST 再跑 regex。主题把 <code>clawd_body</code> 从橙改成 <code>${esc(catalog.palette.dark)}</code>。幂等，可 <code>-NoUpgrade</code> 重打。</p></article>
        <article><h3>Launch</h3><p><code>~\\.local\\bin\\claude</code> 包一层 Bun，加载 <code>cli.original.cjs</code>。<code>provider.json</code> 决定 Anthropic 直连还是 openai-chat 代理。</p></article>
        <article><h3>Verify</h3><p>仓库门禁是 <code>node scripts/verify.mjs</code>（与 CI 同一条）。运行时用 <code>clawgod --blue-status</code> 核主题哈希，<code>clawgod --features</code> 核注册表。升级走本仓库安装器，避免 <code>claude update</code> 盖回上游绿版。</p></article>
      </div>
    </section>
  </main>

  <footer class="wrap">
    <div>GPL-3.0 · Dingfire / pengzzzzz1 · 上游 <a href="https://github.com/0Chencc/clawgod">0Chencc/clawgod</a></div>
    <div>
      <a href="https://github.com/pengzzzzz1/clawgod-blue">源码</a> ·
      <a href="BLUE-README.md">手册</a> ·
      <a href="https://github.com/pengzzzzz1/clawgod-blue/blob/main/src/shared/patch.mjs">patch.mjs</a>
    </div>
  </footer>
  <script>
    document.querySelectorAll('.tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + btn.dataset.t));
      });
    });
    document.querySelectorAll('.copy').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const text = btn.getAttribute('data-copy');
        try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
        catch { btn.textContent = 'Copy failed'; }
        setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
      });
    });
  </script>
</body>
</html>
`;

if (CHECK) {
  if (!existsSync(OUT)) {
    process.stderr.write('index.html missing\n');
    process.exit(1);
  }
  const current = readFileSync(OUT, 'utf8');
  if (current !== html) {
    process.stderr.write('index.html is stale. Run: node web/render-landing.mjs\n');
    process.exit(1);
  }
  process.stdout.write('index.html matches patch.mjs catalog\n');
  process.exit(0);
}

writeFileSync(OUT, html);
for (const f of catalog.features) {
  if (!html.includes(f.id) || !html.includes(esc(f.desc))) {
    throw new Error('generated page missing feature ' + f.id);
  }
}
process.stdout.write('wrote ' + OUT + ' (' + catalog.features.length + ' features, ' + catalog.patches.length + ' patches)\n');
