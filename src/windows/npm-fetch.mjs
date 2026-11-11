// Download and validate an npm platform package without requiring npm CLI.
import { request as httpsRequest } from 'node:https';
import { mkdirSync, writeFileSync, lstatSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function verifyIntegrity(tgz, dist) {
  if (typeof dist?.integrity === 'string' && dist.integrity.trim()) {
    const tokens = dist.integrity.trim().split(/\s+/);
    // Use the strongest published algorithm; do not downgrade after mismatch.
    for (const algorithm of ['sha512', 'sha384', 'sha256', 'sha1']) {
      const hashes = tokens.filter(t => t.startsWith(algorithm + '-'));
      if (!hashes.length) continue;
      const actual = createHash(algorithm).update(tgz).digest('base64');
      if (hashes.some(t => t === algorithm + '-' + actual)) return;
      throw new Error('Package integrity mismatch (' + algorithm + ')');
    }
    throw new Error('Unsupported package integrity metadata');
  }
  if (typeof dist?.shasum === 'string' && /^[0-9a-f]{40}$/i.test(dist.shasum)) {
    if (createHash('sha1').update(tgz).digest('hex') === dist.shasum.toLowerCase()) return;
    throw new Error('Package integrity mismatch (shasum)');
  }
  throw new Error('Missing package integrity metadata');
}

function rejectLinks(path, outDir) {
  const root = resolve(outDir);
  for (let current = resolve(path); ; current = dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('Archive destination contains a link: ' + current);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current === root || dirname(current) === current) break;
  }
}

function destination(outDir, name) {
  if (!name || name.startsWith('/') || /[\\:<>"|?*\x00-\x1f]/.test(name) ||
      name.split('/').some(p => p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(p)))
    throw new Error('Unsafe archive path: ' + name);
  const dest = resolve(outDir, name);
  const rel = relative(resolve(outDir), dest);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Archive path escapes output: ' + name);
  rejectLinks(dest, outDir);
  return dest;
}

function octal(field, label) {
  const value = field.toString('ascii').replace(/\0.*$/, '').trim();
  if (!/^[0-7]+$/.test(value)) throw new Error('Invalid tar ' + label);
  const result = parseInt(value, 8);
  if (!Number.isSafeInteger(result)) throw new Error('Tar ' + label + ' is too large');
  return result;
}

export function extractTar(tar, outDir) {
  const entries = [], seen = new Set();
  let off = 0, ended = false;
  const string = data => data.toString('utf8').replace(/\0.*$/, '');
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every(b => b === 0)) { ended = true; break; }
    const checksum = octal(header.subarray(148, 156), 'checksum');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
    if (sum !== checksum) throw new Error('Tar header checksum mismatch');
    const size = octal(header.subarray(124, 136), 'size');
    const type = String.fromCharCode(header[156]);
    const prefix = string(header.subarray(257, 263)).startsWith('ustar') ? string(header.subarray(345, 500)) : '';
    const name = (prefix ? prefix + '/' : '') + string(header.subarray(0, 100));
    const next = off + 512 + Math.ceil(size / 512) * 512;
    if (!Number.isSafeInteger(next) || next > tar.length) throw new Error('Truncated tar entry: ' + name);
    if (!['0', '\0', '5'].includes(type)) throw new Error('Unsupported tar entry type: ' + type);
    const dest = destination(outDir, type === '5' ? name.replace(/\/+$/, '') : name);
    const identity = process.platform === 'win32' ? dest.toLowerCase() : dest;
    if (seen.has(identity)) throw new Error('Duplicate tar destination: ' + name);
    seen.add(identity);
    if (type === '5' && size !== 0) throw new Error('Tar directory has content: ' + name);
    entries.push({ dest, directory: type === '5', content: tar.subarray(off + 512, off + 512 + size) });
    off = next;
  }
  if (!ended) throw new Error('Tar is missing its end marker');
  if (!entries.some(e => !e.directory)) throw new Error('Tar contains no files');
  const key = p => process.platform === 'win32' ? p.toLowerCase() : p;
  const filePaths = new Set(entries.filter(e => !e.directory).map(e => key(e.dest)));
  const root = resolve(outDir);
  // Reject the whole archive before any output is created.
  for (const entry of entries) {
    // The caller may place outDir below a system alias such as macOS /var.
    // Its ancestors are outside the extraction boundary; do not reject those
    // links while checking the directory types inside the chosen output root.
    for (let parent = dirname(entry.dest); ; parent = dirname(parent)) {
      if (filePaths.has(key(parent))) throw new Error('Tar file/directory conflict');
      try { if (!lstatSync(parent).isDirectory()) throw new Error('Archive parent is not a directory'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (parent === root) break;
    }
    try {
      if (lstatSync(entry.dest).isDirectory() !== entry.directory) throw new Error('Archive destination type conflict');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const entry of entries) {
    rejectLinks(entry.dest, outDir);
    mkdirSync(entry.directory ? entry.dest : dirname(entry.dest), { recursive: true });
    if (!entry.directory) writeFileSync(entry.dest, entry.content);
  }
  return entries.filter(e => !e.directory).length;
}

function get(url, redirects = 0) {
  return new Promise((resolveDownload, reject) => {
    if (redirects > 5) return reject(new Error(`Too many redirects`));
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return reject(new Error('Package downloads require HTTPS'));
    const req = httpsRequest(parsed, { method: 'GET' }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return get(new URL(res.headers.location, parsed), redirects + 1).then(resolveDownload, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${parsed.origin}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolveDownload(Buffer.concat(chunks)));
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('Package download aborted')));
    });
    req.setTimeout(30000, () => req.destroy(new Error('Package download timed out')));
    req.on('error', reject).end();
  });
}

async function main() {
  const [, , pkgSpec, outDir] = process.argv;
  if (!pkgSpec || !outDir) throw new Error('Usage: npm-fetch.mjs <package@version> <output-dir>');
  const last = pkgSpec.lastIndexOf('@');
  const pkg = last > 0 ? pkgSpec.slice(0, last) : pkgSpec;
  const ver = last > 0 ? pkgSpec.slice(last + 1) : 'latest';
  const meta = JSON.parse((await get('https://registry.npmjs.org/' + pkg + '/' + encodeURIComponent(ver))).toString('utf8'));
  if (typeof meta.dist?.tarball !== 'string') throw new Error('Missing package tarball URL');
  console.log('Resolved ' + pkg + '@' + meta.version);
  const tgz = await get(meta.dist.tarball);
  verifyIntegrity(tgz, meta.dist);
  console.log('Downloaded and verified ' + (tgz.length / 1024 / 1024).toFixed(1) + ' MB');
  const files = extractTar(gunzipSync(tgz), outDir);
  console.log('Extracted ' + files + ' files');
  console.log('VERSION=' + meta.version);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
