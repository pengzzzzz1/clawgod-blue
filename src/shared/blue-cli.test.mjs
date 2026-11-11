import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const cli = new URL('./cli.cjs', import.meta.url);
const cliPath = fileURLToPath(cli);
const source = fs.readFileSync(cli, 'utf8');

test('local workspace and status commands do not read damaged provider configuration', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'blue-local-'));
  const env = { ...process.env, HOME: root, USERPROFILE: root };
  fs.mkdirSync(join(root, '.clawgod'));
  fs.writeFileSync(join(root, '.clawgod/provider.json'), 'PRIVATE_BROKEN_CONFIG');
  try {
    const init = spawnSync(process.execPath, [cliPath, '--security', 'init', 'audit', '--title', '本地审计'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    assert.match(init.stdout, /本地审计/);
    const status = spawnSync(process.execPath, [cliPath, '--blue-status', '--json'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(status.status, 1);
    assert.equal(JSON.parse(status.stdout).ok, false);
    assert.doesNotMatch(status.stderr, /PRIVATE|provider/);
    assert.equal(fs.readFileSync(join(root, '.clawgod/provider.json'), 'utf8'), 'PRIVATE_BROKEN_CONFIG');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('security start adds current project context without discarding user arguments or prompt', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'blue-session-'));
  const workspace = require('./security-workspace.cjs');
  const sink = { write() {} };
  assert.equal(workspace.handleCommand(['init', 'retest', '--title', '复测任务'], { cwd: root, stdout: sink, stderr: sink }), 0);
  try {
    let loaded = false;
    let stderr = '';
    const argv = ['bun', 'cli.cjs', '--security', 'start', '--print', '继续复测', '--append-system-prompt', 'Keep existing context'];
    runInNewContext(source, {
      __dirname: root,
      process: { argv, env: {}, cwd: () => root, execPath: '/test/bun', stderr: { isTTY: true, write(text) { stderr += text; } } },
      require(name) {
        if (name === 'os') return { homedir: () => root };
        if (name === './security-workspace.cjs') return workspace;
        if (['./feature-gates.cjs', './runtime-helpers.cjs', './bun-ant-shim.cjs'].includes(name)) return {};
        if (name === './cli.original.cjs') { loaded = true; return {}; }
        return require(name);
      },
    });
    assert.equal(loaded, true);
    assert.equal(stderr, '', '--print must not emit a project overview or banner even when stderr is a terminal');
    assert.equal(argv.filter(arg => arg === '--append-system-prompt').length, 1);
    assert.match(argv[argv.indexOf('--append-system-prompt') + 1], /Keep existing context/);
    assert.match(argv[argv.indexOf('--append-system-prompt') + 1], /复测任务/);
    assert.deepEqual(argv.slice(2, 4), ['--print', '继续复测']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Blue update does not replace the custom edition with an upstream release', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'blue-update-'));
  try {
    const result = spawnSync(process.execPath, [cliPath, 'update', '--version', '2.1.303'], {
      cwd: root, env: { ...process.env, HOME: root, USERPROFILE: root }, encoding: 'utf8',
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Blue source package/);
    assert.equal(fs.existsSync(join(root, '.clawgod')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
