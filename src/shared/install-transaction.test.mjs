import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync, symlinkSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const transaction = require('./install-transaction.cjs');
const { applyLeanSettings } = require('./lean-settings.cjs');
const helper = readFileSync(new URL('./install-transaction.cjs', import.meta.url), 'utf8');
const windows = readFileSync(new URL('../templates/install.ps1', import.meta.url), 'utf8');
const unix = readFileSync(new URL('../templates/install.sh', import.meta.url), 'utf8');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'clawgod transaction space-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const claw = join(root, '.clawgod'), bin = join(root, '.local/bin'), settings = join(root, '.claude/settings.json');
  mkdirSync(claw, { recursive: true }); mkdirSync(bin, { recursive: true }); mkdirSync(join(root, '.claude'));
  return { root, claw, bin, settings, roots: [claw, bin, settings], backup: join(root, 'snapshot') };
}
test('rollback restores runtime, settings, state, flags and native/launcher bytes', t => {
  const f = fixture(t);
  const originals = new Map([
    [join(f.claw, 'cli.cjs'), 'old runtime'], [join(f.claw, 'acorn.mjs'), 'old parser'],
    [join(f.claw, 'features.json'), '{"user":true}'], [join(f.claw, '.lean-max'), ''],
    [join(f.claw, 'lean-state.json'), '{"previous":true}'], [f.settings, '{"userSetting":true}'],
    [join(f.bin, 'claude.cmd'), 'old launcher'], [join(f.bin, 'claude.orig.exe'), 'old native'],
  ]);
  for (const [file, value] of originals) writeFileSync(file, value);
  transaction.snapshot(f.backup, f.roots);
  for (const file of originals.keys()) writeFileSync(file, 'changed');
  rmSync(join(f.claw, '.lean-max'));
  writeFileSync(join(f.claw, '.lean-disabled'), '');
  writeFileSync(join(f.claw, 'patches.json'), '{}');
  writeFileSync(join(f.claw, 'provider.json'), '{"keep":"user config"}');
  writeFileSync(join(f.claw, 'startup-check.log'), 'new diagnostics');
  transaction.restore(f.backup);
  for (const [file, value] of originals) assert.equal(readFileSync(file, 'utf8'), value);
  for (const name of ['.lean-disabled', 'patches.json']) assert.equal(existsSync(join(f.claw, name)), false);
  assert.equal(readFileSync(join(f.claw, 'provider.json'), 'utf8'), '{"keep":"user config"}');
  assert.equal(readFileSync(join(f.claw, 'startup-check.log'), 'utf8'), 'new diagnostics');
});
test('fresh install rollback removes newly created files and preserves unrelated files', t => {
  const f = fixture(t);
  transaction.snapshot(f.backup, f.roots);
  writeFileSync(join(f.claw, 'cli.cjs'), 'new runtime');
  writeFileSync(join(f.bin, 'clawgod.cmd'), 'new launcher');
  writeFileSync(f.settings, '{}');
  writeFileSync(join(f.bin, 'unrelated.cmd'), 'keep');
  transaction.restore(f.backup);
  for (const file of [join(f.claw, 'cli.cjs'), join(f.bin, 'clawgod.cmd'), f.settings]) assert.equal(existsSync(file), false);
  assert.equal(readFileSync(join(f.bin, 'unrelated.cmd'), 'utf8'), 'keep');
});
test('incomplete snapshot is rejected before touching live files', t => {
  const f = fixture(t), runtime = join(f.claw, 'cli.cjs');
  writeFileSync(runtime, 'original');
  transaction.snapshot(f.backup, f.roots);
  const manifest = JSON.parse(readFileSync(join(f.backup, 'manifest.json'), 'utf8'));
  const index = manifest.entries.findIndex(entry => entry.target === runtime);
  rmSync(join(f.backup, String(index)));
  writeFileSync(runtime, 'candidate');
  assert.throws(() => transaction.restore(f.backup), /Incomplete snapshot/);
  assert.equal(readFileSync(runtime, 'utf8'), 'candidate');
});
test('old native backups restore; locked new copies do not prevent settings restoration', t => {
  const f = fixture(t), old = join(f.bin, 'claude.old.exe'), renamed = join(f.bin, 'claude.' + 'a'.repeat(32) + '.exe');
  writeFileSync(old, 'previous native backup');
  writeFileSync(f.settings, '{"original":true}');
  transaction.snapshot(f.backup, f.roots);
  rmSync(old); writeFileSync(renamed, 'in use'); writeFileSync(f.settings, '{}');
  const fs = require('node:fs'), originalRemove = fs.rmSync;
  try {
    fs.rmSync = (file, ...args) => {
      if (file === renamed) throw Object.assign(new Error('fixture locked executable'), { code: 'EPERM' });
      return originalRemove(file, ...args);
    };
    assert.throws(() => transaction.restore(f.backup), /Restore failed.*EPERM/);
  } finally { fs.rmSync = originalRemove; }
  assert.equal(readFileSync(f.settings, 'utf8'), '{"original":true}');
  assert.equal(readFileSync(old, 'utf8'), 'previous native backup');
  assert.ok(existsSync(join(f.backup, 'manifest.json')), 'snapshot retained for retry');
  transaction.restore(f.backup);
  assert.equal(existsSync(renamed), false);
});
test('launcher symlinks restore their link without changing the original target', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t), native = join(f.root, 'official-native'), launcher = join(f.bin, 'claude');
  writeFileSync(native, 'original binary'); symlinkSync(native, launcher);
  transaction.snapshot(f.backup, f.roots);
  rmSync(launcher); writeFileSync(launcher, 'new wrapper');
  transaction.restore(f.backup);
  assert.equal(readlinkSync(launcher), native);
  assert.equal(readFileSync(native, 'utf8'), 'original binary');
});
test('both templates snapshot before payload writes and commit after launcher replacement', () => {
  for (const [source, start, payload, commit, launcher] of [
    [windows, '# --- Snapshot existing installation', '{{CLAWGOD:acorn.mjs}}', '# --- Commit installation', 'Write-OK "Commands'],
    [unix, '# ─── Snapshot existing installation', '{{CLAWGOD:acorn.mjs}}', '# ─── Commit installation', 'write_launcher "$BIN_DIR/clawgod"'],
  ]) {
    assert.ok(source.indexOf(start) < source.indexOf(payload));
    assert.ok(source.indexOf(commit) > source.indexOf(launcher));
    assert.ok(source.indexOf(start) < source.indexOf('Handle'));
    assert.ok(source.includes('{{CLAWGOD:lean-settings.cjs}}'));
  }
});
test('PowerShell transaction restores on thrown failure and explicit exit for fresh and no-upgrade', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const start = windows.indexOf('# --- Snapshot existing installation');
  const end = windows.indexOf('# --- End transaction setup', start);
  const setup = windows.slice(start, end).replace('{{CLAWGOD:install-transaction.cjs}}', () => helper);
  const script = join(f.root, 'failure.ps1');
  for (const [mode, failure] of [['fresh', 'throw "fixture launcher failure"'], ['no-upgrade', 'exit 7']]) {
    const original = mode === 'no-upgrade' ? 'old runtime' : null;
    const runtime = join(f.claw, 'cli.cjs');
    if (original) writeFileSync(runtime, original);
    writeFileSync(f.settings, '{"before":true}');
    writeFileSync(join(f.bin, 'claude.cmd'), 'old launcher');
    writeFileSync(script, `$ErrorActionPreference='Stop'\n$ClawDir=Join-Path $env:USERPROFILE '.clawgod'\n$BinDir=Join-Path $env:USERPROFILE '.local/bin'\nfunction Write-OK($s){}\nfunction Write-Dim($s){}\nfunction Write-Err($s){Write-Host $s}\n${setup}\ntry {\nSet-Content (Join-Path $ClawDir 'cli.cjs') 'candidate'\nSet-Content (Join-Path $env:USERPROFILE '.claude/settings.json') '{}'\nSet-Content (Join-Path $BinDir 'claude.cmd') 'candidate launcher'\n${failure}\n} finally { Restore-Install }\n`);
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
      encoding: 'utf8', timeout: 15000, env: { ...process.env, USERPROFILE: f.root },
    });
    assert.notEqual(result.status, 0, result.stderr + result.stdout);
    assert.equal(original ? readFileSync(runtime, 'utf8') : existsSync(runtime), original || false);
    assert.equal(readFileSync(f.settings, 'utf8'), '{"before":true}');
    assert.equal(readFileSync(join(f.bin, 'claude.cmd'), 'utf8'), 'old launcher');
  }
});
test('POSIX EXIT transaction restores settings and launchers on failure', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t);
  const setup = unix.slice(unix.indexOf('# ─── Snapshot existing installation'), unix.indexOf('# ─── End transaction setup'))
    .replace('{{CLAWGOD:install-transaction.cjs}}', () => helper);
  writeFileSync(join(f.bin, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(f.settings, '{"before":true}');
  const result = spawnSync('bash', ['-c', `set -e\ninfo(){ :; }; warn(){ :; }; dim(){ :; };\n${setup}\nprintf candidate > "$CLAWGOD_DIR/cli.cjs"\nprintf '{}' > "$HOME/.claude/settings.json"\nprintf replaced > "$BIN_DIR/claude"\nexit 9\n`], {
    encoding: 'utf8', env: { ...process.env, HOME: f.root, CLAWGOD_DIR: f.claw, BIN_DIR: f.bin, PATH: f.bin + ':' + process.env.PATH },
  });
  assert.equal(result.status, 9, result.stderr + result.stdout);
  assert.equal(existsSync(join(f.claw, 'cli.cjs')), false);
  assert.equal(readFileSync(f.settings, 'utf8'), '{"before":true}');
  assert.equal(readFileSync(join(f.bin, 'claude'), 'utf8'), '#!/bin/sh\nexit 0\n');
});
test('uninstall restores only owned Lean settings, and invalid settings abort before removing files', t => {
  const f = fixture(t), state = join(f.claw, 'lean-state.json'), installedHelper = join(f.claw, 'lean-settings.cjs');
  const original = { theme: 'dark', disableArtifact: false, permissions: { deny: ['DesignSync', 'Bash(user-policy)'] } };
  const prefix = process.platform === 'win32'
    ? `$ErrorActionPreference='Stop'\n$Uninstall=$true\n$ClawDir=Join-Path $env:USERPROFILE '.clawgod'\n$BinDir=Join-Path $env:USERPROFILE '.local/bin'\nfunction Write-OK($s){}\nfunction Write-Dim($s){}\nfunction Write-Err($s){}\n`
    : `set -e\nUNINSTALL=1\ninfo(){ :; }; warn(){ :; }; dim(){ :; };\n`;
  const section = process.platform === 'win32'
    ? windows.slice(windows.indexOf('# --- Uninstall'), windows.indexOf('# --- Prerequisites'))
    : unix.slice(unix.indexOf('# ─── Uninstall'), unix.indexOf('# ─── Prerequisites'));
  const script = join(f.root, process.platform === 'win32' ? 'uninstall.ps1' : 'uninstall.sh');
  writeFileSync(script, prefix + section);
  const env = { ...process.env, USERPROFILE: f.root, HOME: f.root, CLAWGOD_DIR: f.claw, BIN_DIR: f.bin, PATH: f.bin + (process.platform === 'win32' ? ';' : ':') + process.env.PATH };
  const run = () => spawnSync(process.platform === 'win32' ? 'powershell.exe' : 'bash',
    process.platform === 'win32' ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script] : [script],
    { encoding: 'utf8', timeout: 15000, env });
  const launcher = join(f.bin, process.platform === 'win32' ? 'clawgod.cmd' : 'clawgod');
  const seed = () => {
    copyFileSync(new URL('./lean-settings.cjs', import.meta.url), installedHelper);
    writeFileSync(launcher, process.platform === 'win32' ? '@echo clawgod' : '#!/bin/sh\n# clawgod\n');
    writeFileSync(f.settings, JSON.stringify(original));
    applyLeanSettings(f.settings, 'max', state);
  };
  seed();
  let result = run();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(JSON.parse(readFileSync(f.settings, 'utf8')), original);
  assert.deepEqual(JSON.parse(readFileSync(state, 'utf8')).flags, []);
  assert.equal(existsSync(installedHelper), false);
  seed(); writeFileSync(f.settings, '{broken');
  result = run();
  assert.notEqual(result.status, 0, result.stderr + result.stdout);
  assert.equal(readFileSync(f.settings, 'utf8'), '{broken');
  assert.ok(existsSync(launcher)); assert.ok(existsSync(installedHelper));
});
