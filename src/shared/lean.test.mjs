import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
const wrapper = read('./cli.cjs');
const { applyLeanSettings } = require('./lean-settings.cjs');
const home = fs.mkdtempSync(join(tmpdir(), 'clawgod-lean-test-'));
const dir = join(home, '.clawgod');
const settings = join(home, '.claude', 'settings.json');
const state = join(dir, 'lean-state.json');
const trafficKey = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC';
const originalSettings = { theme: 'dark', permissions: { allow: ['Read'], deny: ['Bash(custom)'] } };
const loadSettings = () => JSON.parse(fs.readFileSync(settings, 'utf8'));
const saveSettings = s => fs.writeFileSync(settings, JSON.stringify(s));
function reset(value = originalSettings) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  saveSettings(value);
}
function launch(args = [], env = {}) {
  const exit = Symbol('exit');
  let loaded = false;
  const proc = { argv: ['node', 'cli.cjs', ...args], env: { ...env }, execPath: '/test/bun',
    stderr: { write() {} }, exit(code) { assert.equal(code, 0); throw exit; } };
  try {
    runInNewContext(wrapper, {
      process: proc,
      require(name) {
        if (name === 'os') return { homedir: () => home };
        if (name === './cli.original.cjs') { loaded = true; return {}; }
        if (['./feature-gates.cjs', './runtime-helpers.cjs', './bun-ant-shim.cjs'].includes(name)) return {};
        if (name === './redline-strip.cjs') return { activate() {} };
        if (name === './supreme-memory.cjs') return () => '# test memory\n';
        return require(name);
      },
    });
  } catch (error) { if (error !== exit) throw error; }
  assert.equal(loaded, args.length === 0);
  return proc.env;
}
function checkMode(mode) {
  const s = loadSettings();
  assert.equal(s.disableRemoteControl, mode === 'max' ? true : undefined, mode);
  assert.equal(s.disableBundledSkills, mode === 'max' ? true : undefined, mode);
  assert.equal(s.disableWorkflows, mode === 'off' ? undefined : true, mode);
  // Vengeance edition: Lean never denies a tool. Only user-authored deny
  // rules (the fixture's Bash(custom)) remain in every mode.
  assert.deepEqual(s.permissions.deny, ['Bash(custom)'], mode);
  assert.equal(s.theme, 'dark');
  assert.deepEqual(s.permissions.allow, ['Read']);
  assert.ok(s.permissions.deny.includes('Bash(custom)'));
}
function child(file, ...args) {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url)), ...args], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
}
try {
  fs.mkdirSync(join(home, '.claude'));
  for (const [label, apply] of [
    ['shared CLI', mode => child('./lean-settings.cjs', settings, mode, state)],
    ['Windows wrappers', mode => mode === 'off'
      ? child('../windows/lean-remove.cjs', settings, state)
      : child('../windows/lean-apply.cjs', settings, mode === 'max' ? 'True' : 'False', state)],
  ]) {
    reset();
    for (const mode of ['on', 'max', 'max', 'on', 'max', 'off', 'off']) { apply(mode); checkMode(mode); }
    assert.deepEqual(loadSettings(), originalSettings);
    console.log(`[lean.test] ${label} tracks ownership through repeated max/on/off transitions`);
  }

  // Same-name settings and deny entries that predate Lean always remain owned
  // by the user, even for legacy installations that have no ownership record.
  const existing = { ...originalSettings, disableRemoteControl: true, disableArtifact: false,
    permissions: { allow: ['Read'], deny: ['CronCreate', 'EnterPlanMode', 'Bash(custom)'] } };
  reset(existing);
  for (const mode of ['off', 'on', 'max', 'on', 'off']) applyLeanSettings(settings, mode, state);
  assert.deepEqual(loadSettings(), existing);
  reset({});
  applyLeanSettings(settings, 'max', state);
  applyLeanSettings(settings, 'off', state);
  assert.deepEqual(loadSettings(), {});
  reset({ permissions: {} });
  applyLeanSettings(settings, 'on', state);
  applyLeanSettings(settings, 'off', state);
  assert.deepEqual(loadSettings(), { permissions: {} });

  // Later explicit overrides and additional deny rules also survive off.
  reset();
  applyLeanSettings(settings, 'max', state);
  const edited = loadSettings();
  edited.disableRemoteControl = false;
  edited.permissions.deny.push('CronCreate', 'Bash(user-added)');
  saveSettings(edited);
  applyLeanSettings(settings, 'off', state);
  assert.deepEqual(loadSettings(), { ...originalSettings, disableRemoteControl: false,
    permissions: { allow: ['Read'], deny: ['Bash(custom)', 'CronCreate', 'Bash(user-added)'] } });

  // Invalid settings/state must fail without replacing either file or mode markers.
  for (const bad of ['{ "secret": "private-value",', 'null', '[]', '{"permissions":[]}', '{"permissions":{"deny":false}}']) {
    reset();
    fs.writeFileSync(settings, bad);
    fs.writeFileSync(join(dir, '.lean-disabled'), '');
    assert.throws(() => launch(['--lean-max']), /Invalid Claude settings/);
    assert.equal(fs.readFileSync(settings, 'utf8'), bad);
    assert.ok(fs.existsSync(join(dir, '.lean-disabled')));
    assert.equal(fs.existsSync(join(dir, '.lean-max')), false);
    assert.equal(fs.existsSync(state), false);
  }
  reset();
  fs.writeFileSync(state, '{bad-state');
  const before = fs.readFileSync(settings, 'utf8');
  assert.throws(() => applyLeanSettings(settings, 'max', state), /Invalid Lean ownership state/);
  assert.equal(fs.readFileSync(settings, 'utf8'), before);
  assert.equal(fs.readFileSync(state, 'utf8'), '{bad-state');

  // Exercise linked leaves on every platform, even when Windows disallows
  // creation of file symlinks for the current account. A dangling link must
  // be rejected by lstat before readFile can mistake ENOENT for a new file.
  for (const linked of [settings, state]) {
    reset();
    const bytes = fs.readFileSync(settings);
    const linkedModule = { exports: {} };
    runInNewContext(read('./lean-settings.cjs'), { module: linkedModule, require(name) {
      if (name !== 'node:fs') return require(name);
      return { ...fs, lstatSync(file) {
        return file === linked ? { isSymbolicLink: () => true, isFile: () => false } : fs.lstatSync(file);
      }, readFileSync(file, ...args) {
        assert.notEqual(file, linked, 'linked JSON must never be followed');
        return fs.readFileSync(file, ...args);
      } };
    } });
    assert.throws(() => linkedModule.exports.applyLeanSettings(settings, 'on', state), /use a regular JSON file/);
    assert.deepEqual(fs.readFileSync(settings), bytes);
    assert.equal(fs.existsSync(state), false);
  }
  let symlinksAvailable = true;
  for (const exists of [true, false]) for (const linked of [settings, state]) {
    if (!symlinksAvailable) continue;
    reset();
    const target = join(home, `linked-json-${exists}-${linked === state ? 'state' : 'settings'}`);
    if (exists) fs.writeFileSync(target, '{"unchanged":true}');
    if (linked === settings) fs.unlinkSync(settings);
    try { fs.symlinkSync(target, linked, 'file'); }
    catch (error) {
      if (!['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
      symlinksAvailable = false;
      console.log('[lean.test] real file symlinks unavailable; linked-leaf rejection covered with filesystem fixture');
      continue;
    }
    try {
      assert.throws(() => applyLeanSettings(settings, 'on', state), /use a regular JSON file/);
      assert.equal(fs.lstatSync(linked).isSymbolicLink(), true);
      assert.equal(fs.readlinkSync(linked), target);
      if (exists) assert.equal(fs.readFileSync(target, 'utf8'), '{"unchanged":true}');
      else assert.equal(fs.existsSync(target), false);
    } finally { fs.unlinkSync(linked); }
  }

  // A state-commit failure restores the original settings bytes.
  reset();
  const originals = fs.readFileSync(settings);
  const module = { exports: {} };
  runInNewContext(read('./lean-settings.cjs'), { module, require(name) {
    if (name !== 'node:fs') return require(name);
    return { ...fs, renameSync(from, to) {
      if (to === state) throw Object.assign(new Error('fixture'), { code: 'EACCES' });
      return fs.renameSync(from, to);
    } };
  } });
  assert.throws(() => module.exports.applyLeanSettings(settings, 'on', state), /Could not save Lean settings/);
  assert.deepEqual(fs.readFileSync(settings), originals);
  assert.equal(fs.existsSync(state), false);
  assert.equal(fs.readdirSync(join(home, '.claude')).filter(name => name.endsWith('.tmp')).length, 0);

  for (const baseURL of ['https://api.anthropic.com', 'https://example.invalid']) {
    reset();
    fs.writeFileSync(join(dir, 'provider.json'), JSON.stringify({ baseURL }));
    assert.equal(launch()[trafficKey], undefined);
    for (const mode of ['on', 'max', 'on', 'max', 'off', 'on']) {
      launch([`--lean-${mode}`]);
      checkMode(mode);
      assert.equal(fs.existsSync(join(dir, '.lean-max')), mode === 'max');
      assert.equal(fs.existsSync(join(dir, '.lean-disabled')), mode === 'off');
      assert.equal(launch()[trafficKey], mode === 'max' ? '1' : undefined);
      checkMode(mode);
      for (const explicit of ['1', '0', '']) assert.equal(launch([], { [trafficKey]: explicit })[trafficKey], explicit);
      assert.equal(launch([], { DISABLE_TELEMETRY: '1' }).DISABLE_TELEMETRY, '1');
    }
    saveSettings({ ...loadSettings(), disableRemoteControl: false });
    launch(['--lean-max']);
    assert.equal(loadSettings().disableRemoteControl, false);
  }
  console.log('[lean.test] user ownership, invalid JSON, I/O rollback, launcher modes and provider parity passed');
} finally { fs.rmSync(home, { recursive: true, force: true }); }
