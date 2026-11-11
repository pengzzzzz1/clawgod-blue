'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

// Vengeance edition: Lean no longer denies any tool. The deny mechanism is
// kept for user-supplied lists, but the built-in deny sets are empty —
// nothing Lean installs can wall a tool call.
const baseDeny = [];
const maxDeny = [];
const baseFlags = ['disableWorkflows', 'disableClaudeAiConnectors', 'disableArtifact'];
const maxFlags = ['disableBundledSkills', 'disableRemoteControl'];
const allFlags = new Set([...baseFlags, ...maxFlags]);
const allDeny = new Set([...baseDeny, ...maxDeny]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function readJSON(file, label) {
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if (error.code === 'ENOENT') return { bytes: null, value: null };
    throw new Error(`Cannot inspect ${label}: ${file}`);
  }
  // Replacing a symlink with an atomic rename would break a dotfiles setup,
  // while following it would edit a target outside the install snapshot.
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`Refusing linked or non-regular ${label}: use a regular JSON file at ${file}`);
  let bytes;
  try { bytes = fs.readFileSync(file); }
  catch (error) {
    throw new Error(`Cannot read ${label}: ${file}`);
  }
  try {
    const value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    if (!object(value)) throw new Error('Expected an object');
    return { bytes, value };
  } catch {
    // Parser messages may include confidential values from the input.
    throw new Error(`Invalid ${label}: expected a JSON object in ${file}`);
  }
}

// Stage both files before replacing either. Restore an already replaced file
// on ordinary I/O errors; installation snapshots also cover process failures.
function writeChanges(changes) {
  const staged = [], committed = [];
  try {
    for (const change of changes) {
      fs.mkdirSync(path.dirname(change.file), { recursive: true });
      const temp = change.file + '.' + randomBytes(8).toString('hex') + '.tmp';
      staged.push({ ...change, temp });
      const mode = change.before === null ? 0o600 : fs.statSync(change.file).mode;
      fs.writeFileSync(temp, change.after, { flag: 'wx', mode });
    }
    for (const change of staged) {
      fs.renameSync(change.temp, change.file);
      committed.push(change);
    }
  } catch (error) {
    const failures = [];
    for (const change of committed.reverse()) {
      try {
        if (change.before === null) fs.unlinkSync(change.file);
        else {
          fs.writeFileSync(change.temp, change.before, { flag: 'wx', mode: fs.statSync(change.file).mode });
          fs.renameSync(change.temp, change.file);
        }
      } catch { failures.push(change.file); }
    }
    throw new Error('Could not save Lean settings' + (failures.length ? '; restoration failed for ' + failures.join(', ') : '') + ` (${error.code || 'I/O error'})`);
  } finally {
    for (const change of staged) {
      try { fs.unlinkSync(change.temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

function applyLeanSettings(settingsPath, mode, statePath) {
  if (!settingsPath || !statePath || !['on', 'max', 'off'].includes(mode))
    throw new Error('Usage: lean-settings.cjs <settingsPath> <on|max|off> <statePath>');
  if (path.resolve(settingsPath) === path.resolve(statePath)) throw new Error('Lean settings and state paths must differ');
  const original = readJSON(settingsPath, 'Claude settings');
  const previous = readJSON(statePath, 'Lean ownership state');
  const settings = original.value || {};
  if (owns(settings, 'permissions') && !object(settings.permissions)) throw new Error('Invalid Claude settings: permissions must be an object');
  if (owns(settings.permissions || {}, 'deny') && (!Array.isArray(settings.permissions.deny) || !settings.permissions.deny.every(value => typeof value === 'string')))
    throw new Error('Invalid Claude settings: permissions.deny must be an array of strings');
  const state = previous.value || { format: 1, flags: [], deny: [], createdPermissions: false, createdDeny: false };
  if (state.format !== 1 || !Array.isArray(state.flags) || !state.flags.every(key => allFlags.has(key)) ||
      !Array.isArray(state.deny) || !state.deny.every(key => allDeny.has(key)) ||
      typeof state.createdPermissions !== 'boolean' || typeof state.createdDeny !== 'boolean')
    throw new Error('Invalid Lean ownership state');
  if (mode === 'off' && previous.value === null) return { changed: false, mode };

  const beforeSettings = JSON.stringify(settings);
  const wantedFlags = new Set(mode === 'off' ? [] : mode === 'max' ? [...baseFlags, ...maxFlags] : baseFlags);
  const wantedDeny = new Set(mode === 'off' ? [] : mode === 'max' ? [...baseDeny, ...maxDeny] : baseDeny);
  const ownedFlags = new Set(), ownedDeny = new Set();
  for (const key of state.flags) {
    // Explicit later user overrides take ownership back from Lean.
    if (settings[key] !== true) continue;
    if (wantedFlags.has(key)) ownedFlags.add(key);
    else delete settings[key];
  }
  for (const key of state.deny) {
    const index = settings.permissions?.deny?.indexOf(key) ?? -1;
    if (index < 0) continue;
    if (wantedDeny.has(key)) ownedDeny.add(key);
    else settings.permissions.deny.splice(index, 1);
  }
  for (const key of wantedFlags) {
    if (!owns(settings, key)) { settings[key] = true; ownedFlags.add(key); }
  }
  if (wantedDeny.size) {
    if (!owns(settings, 'permissions')) { settings.permissions = {}; state.createdPermissions = true; }
    if (!owns(settings.permissions, 'deny')) { settings.permissions.deny = []; state.createdDeny = true; }
    for (const key of wantedDeny) {
      if (!settings.permissions.deny.includes(key)) { settings.permissions.deny.push(key); ownedDeny.add(key); }
    }
  }
  if (state.createdDeny && settings.permissions?.deny?.length === 0) {
    delete settings.permissions.deny;
    state.createdDeny = false;
  }
  if (state.createdPermissions && object(settings.permissions) && Object.keys(settings.permissions).length === 0) {
    delete settings.permissions;
    state.createdPermissions = false;
  }
  state.flags = [...ownedFlags];
  state.deny = [...ownedDeny];
  const changes = [];
  if (beforeSettings !== JSON.stringify(settings)) changes.push({ file: settingsPath, before: original.bytes, after: JSON.stringify(settings, null, 2) + '\n' });
  const stateJSON = JSON.stringify(state, null, 2) + '\n';
  if (previous.bytes?.toString('utf8') !== stateJSON) changes.push({ file: statePath, before: previous.bytes, after: stateJSON });
  writeChanges(changes);
  return { changed: changes.some(change => change.file === settingsPath), mode };
}

module.exports = { applyLeanSettings };
if (require.main === module) {
  try { applyLeanSettings(process.argv[2], process.argv[3], process.argv[4]); }
  catch (error) { process.stderr.write('[clawgod] ' + error.message + '\n'); process.exitCode = 1; }
}
