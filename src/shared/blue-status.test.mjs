import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { inspectBlueStatus, printStatus, renderBanner } = createRequire(import.meta.url)('./blue-status.cjs');
const allIds = ['theme-logo-rgb', 'theme-logo-ansi', 'theme-claude-rgb-dark', 'theme-claude-rgb-light', 'theme-claude-ansi', 'theme-shimmer-rgb', 'theme-shimmer-rgb-light', 'theme-shimmer-ansi', 'theme-hex', 'theme-brief-rgb-dark', 'theme-brief-rgb-light', 'theme-brief-ansi'];
const source = '// Version: 2.1.303\nconst theme={clawd_body:globalThis.__clawgodPatches?.["theme-logo-rgb"]!==false?"rgb(59,130,246)":"rgb(215,119,87)"};\n';
const sha = text => createHash('sha256').update(text).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'clawgod-blue-status-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(join(root, 'cli.original.cjs'), source);
  const record = {
    format: 1, edition: 'clawgod-blue', sourceVersion: '2.1.303',
    theme: { palette: 'blue', appliedIds: ['theme-logo-rgb'], missingIds: allIds.filter(id => id !== 'theme-logo-rgb'), logoPatched: true, logoCount: 1 },
    files: [{ path: 'cli.original.cjs', sha256: sha(source) }],
  };
  const save = () => fs.writeFileSync(join(root, 'blue-patch-state.json'), JSON.stringify(record));
  save();
  return { root, record, save, inspect: (options = {}) => inspectBlueStatus(root, { env: {}, ...options }) };
}

test('verifies source bytes and allows saved configuration with exact environment overrides', t => {
  const f = fixture(t);
  assert.equal(f.inspect().state, 'verified');
  assert.equal(f.inspect().ok, true);
  assert.equal(f.inspect().filesChecked, 1);
  fs.writeFileSync(join(f.root, 'patches.json'), '{"theme":false}');
  assert.equal(f.inspect().state, 'disabled');
  assert.equal(f.inspect().ok, false);
  assert.equal(f.inspect({ env: { CLAWGOD_FEATURE_THEME: 'true' } }).state, 'verified');
  assert.equal(f.inspect({ env: { CLAWGOD_FEATURE_THEME: 'TRUE' } }).state, 'disabled');
  fs.writeFileSync(join(f.root, 'patches.json'), '{}');
  assert.equal(f.inspect({ env: { CLAWGOD_FEATURE_THEME: 'false' } }).state, 'disabled');
});

test('actual runtime gates and status agree on BOM JSON, valid objects and environment overrides', t => {
  const f = fixture(t);
  const require = createRequire(import.meta.url);
  const metadata = spawnSync(process.execPath, [fileURLToPath(new URL('./patch.mjs', import.meta.url)), '--dump-features'], { encoding: 'utf8' });
  assert.equal(metadata.status, 0, metadata.stderr);
  const gateSource = fs.readFileSync(new URL('./feature-gates.cjs', import.meta.url), 'utf8')
    .replace('// {{CLAWGOD:FEATURES_META}}', 'const CLAWGOD_FEATURES_META=' + JSON.stringify(JSON.parse(metadata.stdout)) + ';');
  for (const [body, env] of [
    ['{"theme":false}', {}], ['{"theme":true}', {}], ['{}', {}],
    ['\uFEFF{"theme":false}', {}], ['\uFEFF{"theme":true}', {}],
    ['\uFEFF{"theme":false}', { CLAWGOD_FEATURE_THEME: 'true' }],
    ['\uFEFF{"theme":true}', { CLAWGOD_FEATURE_THEME: 'false' }],
    ['{"theme":false}', { CLAWGOD_FEATURE_THEME: 'TRUE' }],
  ]) {
    fs.writeFileSync(join(f.root, 'patches.json'), body);
    const context = {
      process: { env, stderr: { write() {} } },
      require(name) {
        if (name === 'os') return { homedir: () => f.root };
        if (name === 'fs') return { readFileSync: () => fs.readFileSync(join(f.root, 'patches.json'), 'utf8') };
        return require(name);
      },
    };
    runInNewContext(gateSource, context);
    const status = f.inspect({ env });
    for (const id of allIds) assert.equal(status.enabled, context.__clawgodPatches[id], body + ' / ' + id);
    assert.equal(status.state, status.enabled ? 'verified' : 'disabled');
  }
});

test('changed, deleted, or mismatched runtime files cannot report verified', t => {
  const f = fixture(t);
  fs.writeFileSync(join(f.root, 'cli.original.cjs'), source + '// changed');
  assert.equal(f.inspect().state, 'stale');
  fs.writeFileSync(join(f.root, 'cli.original.cjs'), source.replace('2.1.303', '2.1.304'));
  assert.match(f.inspect().reason, /version/);
  fs.unlinkSync(join(f.root, 'cli.original.cjs'));
  assert.equal(f.inspect().state, 'stale');
});

test('missing, malformed, and unsupported records return explicit non-success states', t => {
  const f = fixture(t);
  fs.unlinkSync(join(f.root, 'blue-patch-state.json'));
  assert.equal(f.inspect().state, 'unverified');
  fs.writeFileSync(join(f.root, 'blue-patch-state.json'), '{broken');
  assert.equal(f.inspect().state, 'invalid');
  for (const value of [null, [], { ...f.record, format: 2 }, { ...f.record, edition: 'other' }, { ...f.record, files: [{ path: 'cli.original.cjs', sha256: 'bad' }] }]) {
    fs.writeFileSync(join(f.root, 'blue-patch-state.json'), JSON.stringify(value));
    assert.equal(f.inspect().state, 'invalid');
  }
  assert.equal(inspectBlueStatus('', { env: {} }).state, 'invalid');
  assert.equal(inspectBlueStatus(join(f.root, 'missing'), { env: {} }).state, 'unverified');
});

test('rejects traversal and path aliases without reading them', t => {
  const f = fixture(t);
  for (const path of ['../outside.js', '/outside.js', 'C:/outside.js', 'bunfs\\outside.js', 'bunfs/../outside.js', 'bunfs//outside.js', 'bunfs. /outside.js', 'bad\0.js']) {
    f.record.files = [{ path, sha256: sha(source) }]; f.save();
    assert.equal(f.inspect().state, 'invalid', path);
  }
});

test('rejects linked source parents with real POSIX symlinks or Windows junctions', t => {
  const f = fixture(t);
  const actual = join(f.root, 'actual');
  fs.mkdirSync(actual); fs.writeFileSync(join(actual, 'theme.js'), source);
  fs.symlinkSync(actual, join(f.root, 'bunfs'), process.platform === 'win32' ? 'junction' : 'dir');
  f.record.files = [{ path: 'bunfs/theme.js', sha256: sha(source) }]; f.save();
  assert.equal(f.inspect().state, 'invalid');
});

test('malformed configuration does not disappear behind a success badge or leak content', t => {
  const f = fixture(t);
  for (const value of ['{ "private-fixture":', '[]', '{"theme":"false"}']) {
    fs.writeFileSync(join(f.root, 'patches.json'), value);
    const result = f.inspect();
    assert.equal(result.state, 'invalid');
    assert.doesNotMatch(result.reason, /private-fixture/);
  }
  fs.unlinkSync(join(f.root, 'patches.json'));
  const separate = join(f.root, 'config'); fs.mkdirSync(separate);
  fs.writeFileSync(join(separate, 'patches.json'), '{"theme":false}');
  assert.equal(f.inspect({ configDir: separate }).state, 'disabled');
});

test('record must name a supported mascot gate and cannot fabricate ID accounting', t => {
  const f = fixture(t);
  f.record.theme.appliedIds = ['theme-hex'];
  f.record.theme.missingIds = allIds.filter(id => id !== 'theme-hex'); f.save();
  assert.equal(f.inspect().state, 'invalid');
  f.record.theme.logoPatched = false; f.record.theme.logoCount = 0; f.save();
  assert.equal(f.inspect().state, 'unverified');
  f.record.theme.missingIds.push('theme-hex'); f.save();
  assert.equal(f.inspect().state, 'invalid');
});

test('JSON output stays machine-readable and only verified banners become blue', t => {
  const f = fixture(t);
  const status = f.inspect(); let output = '';
  printStatus(status, { json: true, stdout: { write(value) { output += value; } } });
  assert.deepEqual(JSON.parse(output), status);
  assert.match(renderBanner(status, { env: {} }), /\x1b\[38;2;59;130;246m/);
  assert.doesNotMatch(renderBanner(status, { env: { NO_COLOR: '' } }), /\x1b/);
  assert.match(renderBanner(status, { env: { NO_COLOR: '1' } }), /已验证/);
  for (const state of ['disabled', 'stale', 'unverified', 'invalid'])
    assert.doesNotMatch(renderBanner({ ...status, state }, { env: {} }), /\x1b/);
});
