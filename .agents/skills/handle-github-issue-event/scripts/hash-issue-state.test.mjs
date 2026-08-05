import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { canonicalSource, compareOrdinal, normalizePlan, planHash, sourceHash } from './hash-issue-state.mjs';

function fixture() {
  return {
    issue: {
      repository: 'owner/repo', number: 7, title: '機能A', body: '要件\r\n本文',
      updatedAt: '2026-08-06T00:00:00Z',
    },
    labels: ['feature', 'Codex:処理中'],
    ownerComments: [
      { id: 2, authorId: 10, createdAt: '2026-08-06T00:02:00Z', updatedAt: 'later', body: '補足2' },
      { id: 1, authorId: 10, createdAt: '2026-08-06T00:01:00Z', body: '補足1' },
    ],
    dependencies: [{ id: 'PR #8', kind: 'pull-request', state: 'draft', retrievedAt: 'volatile' }],
  };
}

test('state/control label and volatile timestamps do not change source hash', () => {
  const first = fixture();
  const second = fixture();
  second.issue.updatedAt = '2026-08-06T10:00:00Z';
  second.labels = ['Codex:承認待ち', 'feature'];
  second.ownerComments[0].updatedAt = 'another timestamp';
  second.dependencies[0].retrievedAt = 'another retrieval';
  assert.equal(sourceHash(first), sourceHash(second));
});

test('meaningful Issue, owner comment, label, and dependency changes are detected', () => {
  const base = sourceHash(fixture());
  for (const mutate of [
    (item) => { item.issue.body = 'changed'; },
    (item) => { item.ownerComments[0].body = 'changed'; },
    (item) => { item.labels.push('security'); },
    (item) => { item.dependencies[0].state = 'merged'; },
  ]) {
    const changed = fixture();
    mutate(changed);
    assert.notEqual(base, sourceHash(changed));
  }
});

test('all owner comments are canonicalized in time order', () => {
  const canonical = canonicalSource(fixture());
  assert.ok(canonical.indexOf('補足1') < canonical.indexOf('補足2'));
});

test('plan hash excludes its result marker and normalizes newlines and trailing spaces', () => {
  const key = 'a'.repeat(64);
  const marker = `<!-- codex-issue-flow state=plan revision=1 handled-dispatch-key=${key} source-sha256=${key} plan-sha256=${key} -->`;
  assert.equal(normalizePlan(`計画  \r\n\r\n${marker}\r\n`), '計画');
  assert.equal(planHash(`計画\n${marker}`), planHash('計画'));
});

test('CLI hashes source JSON and plan text from stdin', () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hash-issue-state.mjs');
  const source = spawnSync(process.execPath, [script, 'source'], { input: JSON.stringify(fixture()), encoding: 'utf8' });
  assert.equal(source.status, 0, source.stderr);
  assert.equal(source.stdout.trim(), sourceHash(fixture()));
  const plan = spawnSync(process.execPath, [script, 'plan'], { input: '計画\r\n', encoding: 'utf8' });
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(plan.stdout.trim(), planHash('計画'));
});

test('canonical source ordering is ordinal and does not use localeCompare', () => {
  assert.equal(compareOrdinal('Z', 'a'), -1);
  assert.equal(compareOrdinal('同', '同'), 0);
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = () => { throw new Error('localeCompare must not be used'); };
  try {
    const input = fixture();
    input.labels.push('Ｚ', 'a', 'A');
    input.dependencies.push({ id: 'Issue あ', kind: 'issue', state: 'open' });
    assert.equal(sourceHash(input), sourceHash(input));
  } finally {
    String.prototype.localeCompare = original;
  }
});

test('dependency projection order does not change source hash', () => {
  const input = fixture();
  input.dependencies = [
    { id: 'PR #1', kind: 'pull-request', state: 'draft', completion: 'merged', type: 'hard', gate: 'start' },
    { id: 'PR #1', kind: 'pull-request', state: 'draft', completion: 'merged', type: 'soft', gate: 'complete' },
  ];
  const reversed = structuredClone(input);
  reversed.dependencies.reverse();
  assert.equal(sourceHash(input), sourceHash(reversed));
  assert.equal(canonicalSource(input), canonicalSource(reversed));
});
