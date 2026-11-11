'use strict';

// A local integrity check for this edition's theme. It never loads the Claude
// bundle, provider configuration, or any network client.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const THEME_IDS = Object.freeze([
  'theme-logo-rgb', 'theme-logo-ansi', 'theme-claude-rgb-dark',
  'theme-claude-rgb-light', 'theme-claude-ansi', 'theme-shimmer-rgb',
  'theme-shimmer-rgb-light', 'theme-shimmer-ansi', 'theme-hex',
  'theme-brief-rgb-dark', 'theme-brief-rgb-light', 'theme-brief-ansi',
]);
const MANIFEST = 'blue-patch-state.json';
const SOURCE_LIMIT = 128 * 1024 * 1024;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function inspectPath(root, relative, { directory = false } = {}) {
  // The format uses POSIX paths even on Windows. Reject aliases before any IO.
  if (typeof relative !== 'string' || !relative || relative.includes('\\') ||
      relative.includes(':') || /[\x00-\x1f\x7f]/.test(relative) ||
      path.posix.isAbsolute(relative) || relative.split('/').some(part =>
        !part || part === '.' || part === '..' || /[. ]$/.test(part))) {
    const error = new Error('Unsafe relative path in theme record.');
    error.kind = 'invalid';
    throw error;
  }
  const parts = relative.split('/');
  let target = root;
  for (const [index, part] of parts.entries()) {
    target = path.join(target, part);
    const info = fs.lstatSync(target);
    if (info.isSymbolicLink() || (index < parts.length - 1 && !info.isDirectory()) ||
        (index === parts.length - 1 && (directory ? !info.isDirectory() : !info.isFile()))) {
      const error = new Error('Theme verification refuses links and non-regular files.');
      error.kind = 'invalid';
      throw error;
    }
  }
  return target;
}
function checkRoot(directory) {
  const root = path.resolve(directory);
  const info = fs.lstatSync(root);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    const error = new Error('Runtime or configuration directory is not a regular directory.');
    error.kind = 'invalid';
    throw error;
  }
  return root;
}
function readObject(filename, limit) {
  if (fs.statSync(filename).size > limit) throw new Error('Record exceeds the verification size limit.');
  const parsed = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  if (!object(parsed)) throw new Error('Record must contain a JSON object.');
  return parsed;
}
function ids(value) {
  return Array.isArray(value) && value.every(id => THEME_IDS.includes(id)) && new Set(value).size === value.length;
}
function validManifest(value) {
  if (!object(value) || value.format !== 1 || value.edition !== 'clawgod-blue' ||
      typeof value.sourceVersion !== 'string' ||
      !/^(?:unknown|\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/.test(value.sourceVersion) ||
      !object(value.theme) || value.theme.palette !== 'blue' ||
      typeof value.theme.logoPatched !== 'boolean' || !ids(value.theme.appliedIds) ||
      !ids(value.theme.missingIds) || !Array.isArray(value.files) || value.files.length > 10000) return false;
  const allIds = [...value.theme.appliedIds, ...value.theme.missingIds];
  if (allIds.length !== THEME_IDS.length || new Set(allIds).size !== THEME_IDS.length) return false;
  if (value.theme.logoCount !== undefined && (!Number.isInteger(value.theme.logoCount) || value.theme.logoCount < 0)) return false;
  if (value.theme.logoPatched && !value.theme.appliedIds.some(id => id === 'theme-logo-rgb' || id === 'theme-logo-ansi')) return false;
  if (value.theme.logoCount !== undefined && value.theme.logoPatched !== (value.theme.logoCount > 0)) return false;
  if (!value.files.every(file => object(file) && typeof file.path === 'string' &&
      /\.(?:cjs|mjs|js)$/.test(file.path) && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256))) return false;
  // Case-folding also rejects Windows aliases when records are inspected elsewhere.
  if (new Set(value.files.map(file => file.path.toLowerCase())).size !== value.files.length) return false;
  return true;
}

function inspectBlueStatus(runtimeDir, options = {}) {
  const env = options.env || process.env;
  const result = {
    edition: 'clawgod-blue', state: 'unverified', status: 'unverified', ok: false,
    enabled: null, reason: '', sourceVersion: null, filesChecked: 0,
    appliedIds: [], missingIds: [], palette: 'blue',
  };
  const finish = (state, reason) => ({ ...result, state, status: state, ok: state === 'verified', reason });
  let root, manifest;
  try {
    if (typeof runtimeDir !== 'string' || !runtimeDir) return finish('invalid', 'Runtime directory is required.');
    root = checkRoot(runtimeDir);
    manifest = readObject(inspectPath(root, MANIFEST), 4 * 1024 * 1024);
  } catch (error) {
    return finish(error.code === 'ENOENT' ? 'unverified' : 'invalid',
      error.code === 'ENOENT' ? 'No blue theme verification record is installed.' : 'Cannot read a valid blue theme verification record.');
  }
  if (!validManifest(manifest)) return finish('invalid', 'Blue theme verification record has an invalid schema.');
  result.sourceVersion = manifest.sourceVersion;
  result.appliedIds = [...manifest.theme.appliedIds];
  result.missingIds = [...manifest.theme.missingIds];

  let enabled = true;
  try {
    const configuration = checkRoot(options.configDir || root);
    let config;
    try { config = readObject(inspectPath(configuration, 'patches.json'), 1024 * 1024); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (config && Object.hasOwn(config, 'theme') && typeof config.theme !== 'boolean')
      return finish('invalid', 'The theme setting must be true or false.');
    if (config) enabled = config.theme !== false;
  } catch (error) {
    return finish('invalid', 'Cannot read valid theme settings.');
  }
  // Match feature-gates.cjs: only these exact strings override saved settings.
  if (env.CLAWGOD_FEATURE_THEME === 'true') enabled = true;
  else if (env.CLAWGOD_FEATURE_THEME === 'false') enabled = false;
  result.enabled = enabled;

  try {
    const entry = inspectPath(root, 'cli.original.cjs');
    if (fs.statSync(entry).size > SOURCE_LIMIT) return finish('invalid', 'Runtime entry exceeds the verification size limit.');
    const version = fs.readFileSync(entry, 'utf8').match(/Version:\s*([\d.]+)/)?.[1];
    if (version && manifest.sourceVersion !== version) return finish('stale', 'Runtime version differs from the blue theme record.');
    for (const file of manifest.files) {
      const filename = inspectPath(root, file.path);
      if (fs.statSync(filename).size > SOURCE_LIMIT) return finish('invalid', 'Theme source exceeds the verification size limit.');
      const hash = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
      if (hash !== file.sha256) return finish('stale', 'A theme source file has changed since patching.');
      result.filesChecked++;
    }
  } catch (error) {
    return finish(error.kind === 'invalid' ? 'invalid' : 'stale',
      error.kind === 'invalid' ? 'Theme source paths contain a link or an invalid path.' : 'A recorded theme source file is missing or unreadable.');
  }
  if (!manifest.theme.logoPatched || !manifest.files.length)
    return finish('unverified', 'This runtime has no verified blue mascot patch.');
  if (!enabled) return finish('disabled', 'Blue theme files are verified, but the theme is disabled.');
  return finish('verified', 'Blue mascot patch and theme source hashes are verified.');
}

function printStatus(status, { json = false, stdout = process.stdout } = {}) {
  if (json) stdout.write(JSON.stringify(status, null, 2) + '\n');
  else stdout.write([
    'ClawGod Blue / 补丁状态',
    '状态: ' + status.state,
    'Claude 版本: ' + (status.sourceVersion || '未知'),
    '主题启用: ' + (status.enabled === null ? '未知' : status.enabled ? '是' : '否'),
    '已核验主题文件: ' + status.filesChecked,
    status.reason,
    '此检查验证蓝色主题文件及开关，不代表所有客户端功能均已验证。',
  ].join('\n') + '\n');
}

function renderBanner(status, { env = process.env } = {}) {
  const verified = status.state === 'verified';
  const label = 'ClawGod Blue · 网安任务总览 | ' + (verified ? '蓝色主题已验证' : '主题状态: ' + status.state);
  return verified && !Object.hasOwn(env, 'NO_COLOR') ? '\x1b[38;2;59;130;246m' + label + '\x1b[0m' : label;
}

module.exports = { inspectBlueStatus, printStatus, renderBanner };
