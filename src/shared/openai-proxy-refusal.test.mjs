import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isRefusalText, shouldRetry, DSH_CONTRACT } = require('./openai-proxy.cjs');

test('refusal detector pins the continue-turn heuristic', () => {
  assert.equal(isRefusalText('I cannot assist with that request.'), true);
  assert.equal(isRefusalText('我不能协助这个目标。'), true);
  assert.equal(isRefusalText('ok, here is the parser'), false);
  assert.equal(isRefusalText('short'), false);
  assert.equal(shouldRetry('I cannot assist with that request.', false), true);
  assert.equal(shouldRetry('I cannot assist with that request.', true), false);
  assert.match(DSH_CONTRACT, /^# Workspace execution contract\n/);
});
