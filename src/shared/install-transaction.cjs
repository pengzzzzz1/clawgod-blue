'use strict';
// Snapshot only installer-owned paths. User providers, audit files and startup
// diagnostics are intentionally outside this transaction.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const runtimeFiles = [
  'cli.original.cjs', 'cli.original.cjs.bak', 'cli.original.js', '.source-version',
  'source-backup.json', 'bunfs', 'vendor', 'pathmap.json', 'extract-natives.mjs',
  'post-process.mjs', 'repatch.mjs', 'openai-proxy.cjs', 'feature-gates.cjs',
  'cli.cjs', '.clawgod-version', 'startup-check.cjs', 'runtime-helpers.cjs',
  'blue-status.cjs', 'security-workspace.cjs', 'blue-patch-state.json',
  'bun-ant-shim.cjs', 'patch.mjs', 'ast-patches.mjs', 'acorn.mjs', 'acorn.LICENSE',
  'lean-settings.cjs', 'lean-state.json', '.lean-disabled', '.lean-max',
  'features.json', 'patches.json', 'claude.staged', 'claude.staged.exe',
  'clawgod-import', 'clawgod-import.exe',
];
const launcherFiles = ['claude', 'claude.orig', 'clawgod', 'claude.cmd',
  'claude.orig.cmd', 'claude.exe', 'claude.orig.exe', 'clawgod.cmd'];
const oldNativeName = /^claude\..+\.exe$/i;
const renamedNativeName = /^claude\.[a-f0-9]{32}\.exe$/i;

function targets(roots) {
  const [clawDir, binDir, settingsPath, externalClaude] = roots;
  if (![clawDir, binDir, settingsPath].every(value => typeof value === 'string' && path.isAbsolute(value)))
    throw new Error('Transaction paths must be absolute');
  const files = [...runtimeFiles.map(name => path.join(clawDir, name)),
    ...launcherFiles.map(name => path.join(binDir, name)), settingsPath];
  if (externalClaude) {
    if (!path.isAbsolute(externalClaude) || path.basename(externalClaude) !== 'claude')
      throw new Error('Invalid external launcher path');
    files.push(externalClaude, externalClaude + '.orig');
  }
  return [...new Set(files.map(value => path.resolve(value)))];
}
function stat(file) {
  try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function same(left, right) {
  const a = stat(left), b = stat(right);
  if (!a || !b) return a === b;
  if (a.isSymbolicLink() || b.isSymbolicLink())
    return a.isSymbolicLink() && b.isSymbolicLink() && fs.readlinkSync(left) === fs.readlinkSync(right);
  if (a.isDirectory() || b.isDirectory()) {
    if (!a.isDirectory() || !b.isDirectory()) return false;
    const names = fs.readdirSync(left).sort(), other = fs.readdirSync(right).sort();
    return JSON.stringify(names) === JSON.stringify(other) && names.every(name => same(path.join(left, name), path.join(right, name)));
  }
  if (a.size !== b.size || (a.mode & 0o777) !== (b.mode & 0o777)) return false;
  const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return digest(left) === digest(right);
}
function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true });
}
function snapshot(directory, roots) {
  const files = targets(roots), extras = [];
  if (stat(roots[1])) {
    for (const name of fs.readdirSync(roots[1])) {
      const target = path.join(roots[1], name);
      if (oldNativeName.test(name) && !files.includes(target)) extras.push(target);
    }
  }
  files.push(...extras);
  if (stat(directory)) throw new Error('Snapshot directory already exists');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const manifest = { format: 1, roots, extras, entries: [] };
  try {
    for (const [index, target] of files.entries()) {
      const present = !!stat(target);
      if (present) copy(target, path.join(directory, String(index)));
      manifest.entries.push({ target, present });
    }
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
function restore(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const files = targets(manifest.roots);
  if (!Array.isArray(manifest.extras) || manifest.extras.some(target =>
    typeof target !== 'string' || path.dirname(target) !== manifest.roots[1] || !oldNativeName.test(path.basename(target)) || files.includes(target)))
    throw new Error('Invalid snapshot extra paths');
  files.push(...manifest.extras);
  if (manifest.format !== 1 || !Array.isArray(manifest.entries) || manifest.entries.length !== files.length ||
      manifest.entries.some((entry, index) => entry.target !== files[index] || typeof entry.present !== 'boolean'))
    throw new Error('Invalid snapshot manifest');
  // Validate every backup before changing a live file. Keep the snapshot if
  // restoration fails, so a locked Windows executable can be retried later.
  for (const [index, entry] of manifest.entries.entries()) {
    if (entry.present && !stat(path.join(directory, String(index)))) throw new Error('Incomplete snapshot');
  }
  const failures = [];
  for (const [index, entry] of manifest.entries.entries()) {
    const source = path.join(directory, String(index));
    try {
      if (entry.present && same(source, entry.target)) continue;
      fs.rmSync(entry.target, { recursive: true, force: true });
      if (entry.present) copy(source, entry.target);
    } catch (error) { failures.push(entry.target + ': ' + error.code); }
  }
  // Only remove GUID-named copies that this install could have renamed aside.
  // Older backups removed by the launcher's cleanup have already been restored.
  if (stat(manifest.roots[1])) {
    for (const name of fs.readdirSync(manifest.roots[1])) {
      const target = path.join(manifest.roots[1], name);
      if (!renamedNativeName.test(name) || files.includes(target)) continue;
      try { fs.rmSync(target, { force: true }); }
      catch (error) { failures.push(target + ': ' + error.code); }
    }
  }
  if (failures.length) throw new Error('Restore failed for ' + failures.join(', '));
}

module.exports = { snapshot, restore, targets };
if (require.main === module) {
  try {
    const [action, directory, ...roots] = process.argv.slice(2);
    if (action === 'snapshot') snapshot(path.resolve(directory), roots.map(value => value ? path.resolve(value) : ''));
    else if (action === 'restore') restore(path.resolve(directory));
    else throw new Error('Expected snapshot or restore');
  } catch (error) {
    console.error('[clawgod] Install transaction: ' + error.message);
    process.exitCode = 1;
  }
}
