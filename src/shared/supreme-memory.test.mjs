import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const render = require('./supreme-memory.cjs');
const source = readFileSync(new URL('./supreme-memory.cjs', import.meta.url), 'utf8');

test('supreme-memory is a renderer, not a snapshot of the maintainer machine', () => {
  assert.equal(typeof render, 'function');
  const text = render({ home: 'C:\\Users\\Example', workspace: 'D:\\lab' });
  assert.match(text, /D:\/lab/);
  assert.match(text, /C:\/Users\/Example/);
  assert.doesNotMatch(text, /23013/);
  assert.doesNotMatch(text, /103\.97/);
  assert.doesNotMatch(text, /122\.10/);
  assert.doesNotMatch(source, /23013/);
  assert.doesNotMatch(source, /103\.97/);
  assert.doesNotMatch(source, /122\.10/);
});
