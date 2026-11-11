import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { BLUE_THEME_IDS, BLUE_THEME_PALETTE, scanAstPatches, applyAstEdits, parsePatchSource } from './ast-patches.mjs';

const source = `
const dark={clawd_body:'rgb(215,119,87)',claude:'rgb(215,119,87)',claudeShimmer:'rgb(245,149,117)',briefLabelClaude:'rgb(215,119,87)',success:'rgb(34,197,94)',error:'ansi:redBright'};
const light={['claude']:'rgb(255,153,51)',claudeShimmer:'rgb(255,183,101)',briefLabelClaude:'rgb(255,153,51)'};
const ansi={'clawd_body':'ansi:redBright',claude:'ansi:redBright',claudeShimmer:'ansi:yellowBright',briefLabelClaude:'ansi:redBright'};
const hex=chalk['hex']('#da7756');
const decoy={color:'#da7756','#da7756':'object key',text:'clawd_body:"rgb(215,119,87)"'};
// clawd_body:'rgb(215,119,87)'
`;
const scan = scanAstPatches(source);
for (const id of BLUE_THEME_IDS) assert.equal(scan[id].matches.length, 1, id);
const output = applyAstEdits(source, BLUE_THEME_IDS.flatMap(id => scan[id].matches));
parsePatchSource(output);
const result = enabled => runInNewContext(`${output};JSON.stringify({dark,light,ansi,hex,decoy})`, {
  chalk: { hex: color => color },
  __clawgodPatches: Object.fromEntries(BLUE_THEME_IDS.map(id => [id, enabled])),
});
const original = JSON.parse(runInNewContext(`${source};JSON.stringify({dark,light,ansi,hex,decoy})`, {chalk:{hex:color=>color}}));
assert.deepEqual(JSON.parse(result(false)), original, 'disabled theme preserves upstream colors exactly');
const blue = JSON.parse(result(true));
assert.equal(blue.dark.clawd_body, BLUE_THEME_PALETTE.dark);
assert.equal(blue.light.claude, BLUE_THEME_PALETTE.light);
assert.equal(blue.ansi.clawd_body, BLUE_THEME_PALETTE.ansi);
assert.equal(blue.dark.claudeShimmer, BLUE_THEME_PALETTE.shimmer);
assert.equal(blue.hex, BLUE_THEME_PALETTE.hex);
assert.deepEqual(blue.decoy, original.decoy);
assert.equal(blue.dark.success, original.dark.success);
assert.equal(blue.dark.error, original.dark.error);
const rescan = scanAstPatches(output);
for (const id of BLUE_THEME_IDS) {
  assert.equal(rescan[id].matches.length, 0, 'blue gates are idempotent');
  assert.equal(rescan[id].blueCount, 1, 'only actual blue gates count');
}

// Existing green builds can migrate without relying on quote formatting.
const green = 'const theme={clawd_body:globalThis.__clawgodPatches?.["theme-logo-rgb"]!==!1?"rgb(34,197,94)":"rgb(215,119,87)"};';
const migrate = scanAstPatches(green)['theme-logo-rgb'];
assert.equal(migrate.matches.length, 1);
const migrated = applyAstEdits(green, migrate.matches);
assert.equal(runInNewContext(`${migrated};theme.clawd_body`), BLUE_THEME_PALETTE.dark);
assert.equal(scanAstPatches(migrated)['theme-logo-rgb'].matches.length, 0);
for (const decoy of [
  'const t={clawd_body:"rgb(215,119,87)",clawd_body:"other"}',
  'const t={...dynamic,clawd_body:"rgb(215,119,87)"}',
  'const t={[dynamic]:1,clawd_body:"rgb(215,119,87)"}',
  'const t={get clawd_body(){return "rgb(215,119,87)"}}',
  'const t={clawd_body:otherGate?"rgb(59,130,246)":"rgb(215,119,87)"}',
  'const text="#da7756", t={"#da7756":"key",error:"#da7756"}',
]) {
  assert.equal(BLUE_THEME_IDS.flatMap(id => scanAstPatches(decoy)[id].matches).length, 0, decoy);
}

const root = mkdtempSync(join(tmpdir(), 'clawgod-blue-theme-'));
try {
  for (const name of ['patch.mjs', 'ast-patches.mjs', 'acorn.mjs']) copyFileSync(new URL(`./${name}`, import.meta.url), join(root, name));
  const entry = join(root, 'cli.original.cjs'), manifest = join(root, 'blue-patch-state.json');
  writeFileSync(entry, '// Version: 2.1.303\n' + source);
  const run = (...args) => spawnSync(process.execPath, [join(root, 'patch.mjs'), ...args], {encoding:'utf8'});
  for (const args of [['--dry-run'], ['--verify']]) {
    const proc = run(...args);
    assert.equal(proc.status, 0, proc.stdout + proc.stderr);
    assert.equal(existsSync(manifest), false, 'read-only runs do not report applied state');
  }
  assert.equal(run('--capture-clean-source').status, 0);
  const apply = run();
  assert.equal(apply.status, 0, apply.stdout + apply.stderr);
  const state = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.equal(state.edition, 'clawgod-blue');
  assert.equal(state.sourceVersion, '2.1.303');
  assert.equal(state.theme.logoPatched, true);
  assert.equal(state.theme.logoCount, 2);
  assert.equal(state.theme.appliedIds.length, 12);
  assert.equal(state.theme.missingIds.length, 0);
  assert.deepEqual(state.files, [{path:'cli.original.cjs',sha256:createHash('sha256').update(readFileSync(entry)).digest('hex')}]);
  const first = readFileSync(entry, 'utf8');
  assert.equal(run().status, 0);
  assert.equal(readFileSync(entry, 'utf8'), first, 'clean-source repatch is deterministic');
  assert.equal(run('--revert').status, 0);
  assert.equal(existsSync(manifest), false, 'revert invalidates successful state');

  // In a graph, a failed later write must never refresh an earlier manifest.
  rmSync(join(root, 'source-backup.json'));
  mkdirSync(join(root, 'bunfs'));
  writeFileSync(entry, '// Version: 2.1.303\n// graph entry');
  writeFileSync(join(root, 'bunfs/a.js'), source);
  writeFileSync(join(root, 'bunfs/b.js'), 'const other={clawd_body:"rgb(215,119,87)"};');
  const oldState = '{"stale":"do not refresh on partial failure"}\n';
  writeFileSync(manifest, oldState);
  const preload = join(root, 'fail-write.cjs');
  writeFileSync(preload, `const fs=require('node:fs');const original=fs.writeFileSync;fs.writeFileSync=function(file,...args){if(String(file).endsWith('b.js'))throw new Error('fixture write failure');return original.call(this,file,...args)};require('node:module').syncBuiltinESMExports();`);
  const fail = spawnSync(process.execPath, ['--require', preload, join(root, 'patch.mjs')], {encoding:'utf8'});
  assert.equal(fail.status, 1);
  assert.match(fail.stderr, /fixture write failure/);
  assert.equal(readFileSync(manifest, 'utf8'), oldState);
  assert.notEqual(readFileSync(join(root, 'bunfs/a.js'), 'utf8'), source, 'fixture actually failed after an earlier write');
} finally {
  rmSync(root, {recursive:true,force:true});
}
console.log('[blue-theme.test] blue palettes, original-color fallback, semantic matching, repatch and post-write manifests passed');
