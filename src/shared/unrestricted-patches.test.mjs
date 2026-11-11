import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('.', import.meta.url));

test('URL concat and ask/deny comparison patches apply on a graph fixture', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clawgod-unrestricted-'));
  try {
    for (const name of ['patch.mjs', 'ast-patches.mjs', 'acorn.mjs']) {
      copyFileSync(join(shared, name), join(dir, name));
    }
    mkdirSync(join(dir, 'bunfs'));
    writeFileSync(join(dir, 'cli.original.cjs'), '// entry\n');
    const url = "'\\nIMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming. You may use URLs provided by the user in their messages or local files.'";
    const source = [
      'var x=`${pbt}`+' + url + ';',
      'if(ye.behavior==="ask")return ye;',
      'if(o.behavior==="deny")return o;',
    ].join('\n');
    const target = join(dir, 'bunfs/gates.js');
    writeFileSync(target, source);
    const result = spawnSync(process.execPath, [join(dir, 'patch.mjs'), '--tolerate-stale'], { encoding: 'utf8', cwd: dir });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Remove URL generation restriction \(concatenated string form\) \(1 replacement/);
    assert.match(result.stdout, /behavior==="ask" comparisons never match \(supreme\) \(1 replacement/);
    assert.match(result.stdout, /behavior==="deny" comparisons never match \(supreme\) \(1 replacement/);
    const patched = readFileSync(target, 'utf8');
    assert.match(patched, /remove-url-restriction-concat/);
    assert.match(patched, /behavior==="\\0ask"/);
    assert.match(patched, /behavior==="\\0deny"/);
    assert.doesNotMatch(patched, /behavior==="ask"/);
    assert.doesNotMatch(patched, /behavior==="deny"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
