#!/usr/bin/env node
/**
 * Engineering gate for ClawGod Blue.
 * Counts, catalog, landing and installers must come from source — this
 * script is the command README and CI are allowed to cite.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
let failed = 0;

function run(label, args, opts = {}) {
  const result = spawnSync(node, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  const ok = result.status === 0;
  if (!ok) failed++;
  process.stdout.write(`${ok ? 'ok' : 'FAIL'}  ${label}\n`);
  if (!ok) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  return result;
}

const catalog = run('patch.mjs --catalog', ['src/shared/patch.mjs', '--catalog']);
if (catalog.status === 0) {
  let parsed;
  try { parsed = JSON.parse(catalog.stdout); }
  catch {
    failed++;
    process.stderr.write('FAIL  catalog is not JSON\n');
  }
  if (parsed) {
    if (parsed.edition !== 'clawgod-blue' || parsed.palette?.dark !== 'rgb(59,130,246)') {
      failed++;
      process.stderr.write('FAIL  catalog edition/palette mismatch\n');
    } else {
      process.stdout.write(`ok    catalog ${parsed.features.length} features / ${parsed.patches.length} patches\n`);
    }
  }
}

run('landing --check', ['web/render-landing.mjs', '--check']);
run('build.js --check', ['build.js', '--check']);

const unit = [
  'src/shared/redline-strip.test.mjs',
  'src/shared/openai-proxy.test.mjs',
  'src/shared/openai-proxy-refusal.test.mjs',
  'src/shared/blue-cli.test.mjs',
  'src/shared/blue-theme.test.mjs',
  'src/shared/blue-status.test.mjs',
  'src/shared/security-workspace.test.mjs',
  'src/shared/lean.test.mjs',
  'src/shared/supreme-memory.test.mjs',
  'src/shared/unrestricted-patches.test.mjs',
];
run('node --test (blue + unrestricted)', ['--test', ...unit]);

const scripts = [
  ['src/shared/provider.test.mjs', 'provider.test.mjs'],
  ['src/shared/patch.test.mjs', 'patch.test.mjs'],
  ['src/shared/ast-patches.test.mjs', 'ast-patches.test.mjs'],
  ['src/shared/source-backup.test.mjs', 'source-backup.test.mjs'],
  ['src/shared/startup-check.test.mjs', 'startup-check.test.mjs'],
  ['src/shared/bun-ant-shim.test.mjs', 'bun-ant-shim.test.mjs'],
];
for (const [file, label] of scripts) run(label, [file]);

if (failed) {
  process.stderr.write(`verify failed (${failed} step(s))\n`);
  process.exit(1);
}
process.stdout.write('verify ok\n');
