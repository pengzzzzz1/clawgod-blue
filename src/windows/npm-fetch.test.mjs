import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyIntegrity, extractTar } from './npm-fetch.mjs';

function archive(entries) {
  return Buffer.concat([...entries.flatMap(({ name, text = 'fixture', type = '0', prefix = '' }) => {
    const body = Buffer.from(type === '5' ? '' : text);
    const h = Buffer.alloc(512);
    h.write(name); h.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
    h.fill(32, 148, 156); h[156] = type.charCodeAt(0);
    h.write('ustar\0', 257); h.write(prefix, 345);
    h.write(h.reduce((sum, n) => sum + n, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    return [h, body, Buffer.alloc((512 - body.length % 512) % 512)];
  }), Buffer.alloc(1024)]);
}

test('integrity prefers the strongest digest and rejects corruption/missing metadata', () => {
  const data = Buffer.from('package fixture');
  const hash = a => createHash(a).update(data).digest('base64');
  verifyIntegrity(data, { integrity: 'sha512-' + hash('sha512') });
  verifyIntegrity(data, { shasum: createHash('sha1').update(data).digest('hex') });
  assert.throws(() => verifyIntegrity(data, { integrity: 'sha256-' + hash('sha256') + ' sha512-bad' }), /mismatch/);
  assert.throws(() => verifyIntegrity(Buffer.from('altered'), { integrity: 'sha512-' + hash('sha512') }), /mismatch/);
  assert.throws(() => verifyIntegrity(data, {}), /Missing/);
  assert.throws(() => verifyIntegrity(data, { integrity: 'md5-bad' }), /Unsupported/);
  verifyIntegrity(data, { integrity: 'sha256-bad sha512-bad sha512-' + hash('sha512') });
  verifyIntegrity(data, { shasum: createHash('sha1').update(data).digest('hex').toUpperCase() });
});

test('extracts regular files, directories and ustar prefixes', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawgod-tar-'));
  try {
    assert.equal(extractTar(archive([{ name: 'package/', type: '5' }, { name: 'claude.exe', prefix: 'package/bin' }]), root), 1);
    assert.equal(readFileSync(join(root, 'package/bin/claude.exe'), 'utf8'), 'fixture');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects paths, links, aliases, checksum errors and truncation before writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawgod-tar-reject-'));
  try {
    const cases = [
      ...['../escape', '/absolute', 'C:/drive', 'package\\..\\escape', 'package/x:ads', 'package/../x', 'package/CON', 'package/x.',
        'package/x<', 'package/x>', 'package/x"', 'package/x|', 'package/x?', 'package/x*',
        'package/CONIN$', 'package/conout$.txt', 'package/COM\u00b9.txt', 'package/LPT\u00b2', 'package/COM\u00b3',
      ].map(name => archive([{ name: 'package/ok' }, { name }])),
      archive([{ name: 'package/link', type: '2' }]),
      archive([{ name: 'package/ok' }, { name: 'package/ok' }]),
      archive([{ name: 'package/file' }, { name: 'package/file/child' }]),
      archive([{ name: 'package/ok' }]).subarray(0, 515),
    ];
    const broken = archive([{ name: 'package/ok' }]); broken[0] ^= 1; cases.push(broken);
    for (const tar of cases) {
      const output = join(root, 'out');
      assert.throws(() => extractTar(tar, output));
      assert.equal(existsSync(output), false, 'rejected archive must not create partial output');
    }
    const output = join(root, 'links'); mkdirSync(output);
    const outside = join(root, 'outside'); mkdirSync(outside);
    symlinkSync(outside, join(output, 'package'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => extractTar(archive([{ name: 'package/ok' }]), output), /link/);
    assert.equal(existsSync(join(outside, 'ok')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('permits symlinked ancestors above outDir but rejects a symlinked output root', () => {
  const root = mkdtempSync(join(tmpdir(), 'clawgod-tar-ancestor-'));
  try {
    const actual = join(root, 'actual'); mkdirSync(actual);
    const alias = join(root, 'alias');
    symlinkSync(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const tar = archive([{ name: 'package/claude.exe' }]);
    assert.equal(extractTar(tar, join(alias, 'out')), 1);
    assert.equal(readFileSync(join(actual, 'out/package/claude.exe'), 'utf8'), 'fixture');
    assert.throws(() => extractTar(tar, alias), /link/);
    assert.equal(existsSync(join(actual, 'package')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
