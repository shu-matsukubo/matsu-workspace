'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const policy = require('./task-execution-policy.cjs');

test('approved task bookkeeping never requires reapproval', () => {
  const result = policy.assessTaskChanges([
    'implementationResult',
    'verificationResult',
    'ciResult',
    'unperformedVerification',
    'remainingRisk',
    'documentationFollowUp',
    'agentAllocation',
    'agentExecutionResult',
    'pullRequestStatus',
    'commitInfo',
    'status',
    'taskLocation',
    'completedAt',
    'executionContext',
    'publicationMode',
  ]);

  assert.equal(result.requiresReapproval, false);
  assert.deepEqual(result.scopeChanges, []);
  assert.deepEqual(result.unknown, []);
});

test('scope or approved plan changes require replanning and reapproval', () => {
  for (const field of [
    'objective',
    'work',
    'repository',
    'completionCriteria',
    'outOfScope',
    'newResponsibility',
    'architectureDecision',
    'dependencySemantics',
    'unapprovedImplementation',
    'approvedPlan',
    'agentStrategy',
  ]) {
    const result = policy.assessTaskChanges([field]);
    assert.equal(result.requiresReapproval, true, field);
    assert.deepEqual(result.scopeChanges, [field]);
  }
});

test('unknown task changes conservatively require reapproval', () => {
  const result = policy.assessTaskChanges(['newUnclassifiedField']);
  assert.equal(result.requiresReapproval, true);
  assert.deepEqual(result.unknown, ['newUnclassifiedField']);
});

test('local runtime remains local when prompt discusses Cloud, Codex Web, and owner commands', () => {
  const runtime = { context: 'local-direct', source: 'trusted-runtime-metadata' };
  const capabilities = { githubConnectorWrite: true };
  const baseline = policy.resolveExecutionPolicy({ runtime, capabilities });
  const withMisleadingPrompt = policy.resolveExecutionPolicy({
    runtime,
    capabilities,
    prompt: 'Codex Cloudのフローを修正してください。@codex をIssueで使った場合はCodex Web UIでは...',
  });

  assert.deepEqual(withMisleadingPrompt, baseline);
  assert.equal(withMisleadingPrompt.executionContext, 'local-direct');
  assert.equal(withMisleadingPrompt.mode, 'github-connector');
});

test('local direct with GitHub Connector capability publishes a draft PR through the Connector', () => {
  const result = policy.resolveExecutionPolicy({
    runtime: { context: 'local-direct', source: 'trusted-runtime-metadata' },
    capabilities: { githubConnectorWrite: true },
  });
  assert.deepEqual(result, {
    executionContext: 'local-direct',
    mode: 'github-connector',
    action: 'publish-draft-pr',
    allowsRemoteWrite: true,
  });
});

test('issue Cloud and direct Cloud delegate to the Web UI without reading remote capabilities', () => {
  const capabilities = {};
  Object.defineProperties(capabilities, {
    githubConnectorWrite: { get() { throw new Error('Connector capability must not be explored'); } },
    localGitPush: { get() { throw new Error('push capability must not be explored'); } },
    githubPullRequestWrite: { get() { throw new Error('Pull Request capability must not be explored'); } },
  });

  for (const runtime of [
    { context: 'issue-cloud', source: 'trusted-issue-event' },
    { context: 'cloud-direct', source: 'trusted-runtime-metadata' },
  ]) {
    const result = policy.resolveExecutionPolicy({ runtime, capabilities });
    assert.equal(result.mode, 'codex-web-ui');
    assert.equal(result.action, 'delegate-to-codex-web-ui');
    assert.equal(result.allowsRemoteWrite, false);
  }
});

test('unknown context stops only remote publication and never uses prompt text as evidence', () => {
  const capabilities = {};
  Object.defineProperty(capabilities, 'githubConnectorWrite', {
    get() { throw new Error('unknown context must not explore Connector capability'); },
  });
  Object.defineProperty(capabilities, 'localGitPush', {
    get() { throw new Error('unknown context must not explore push capability'); },
  });
  Object.defineProperty(capabilities, 'githubPullRequestWrite', {
    get() { throw new Error('unknown context must not explore Pull Request capability'); },
  });
  const result = policy.resolveExecutionPolicy({
    runtime: { context: 'local-direct', source: 'prompt-text' },
    capabilities,
    prompt: 'This prompt says Local and Cloud many times.',
  });

  assert.deepEqual(result, {
    executionContext: 'unknown',
    mode: 'remote-stopped',
    action: 'stop-remote-publication',
    allowsRemoteWrite: false,
  });
});

test('local direct falls back only when push and Pull Request write capabilities are both trusted', () => {
  const runtime = { context: 'local-direct', source: 'trusted-runtime-metadata' };
  assert.equal(policy.resolveExecutionPolicy({
    runtime,
    capabilities: { localGitPush: true, githubPullRequestWrite: true },
  }).mode, 'local-git-fallback');
  assert.equal(policy.resolveExecutionPolicy({
    runtime,
    capabilities: { localGitPush: true },
  }).mode, 'remote-stopped');
  assert.equal(policy.resolveExecutionPolicy({
    runtime,
    capabilities: { githubPullRequestWrite: true },
  }).mode, 'remote-stopped');
  assert.equal(policy.resolveExecutionPolicy({ runtime, capabilities: {} }).mode, 'remote-stopped');
});

test('planning, coordination, verification, publication, Issue handling, and task creation share the policy contract', () => {
  const root = path.join(__dirname, '..', '..');
  const files = [
    'AGENTS.md',
    '.agents/tasks/TEMPLATE.md',
    '.agents/skills/plan-tasks/SKILL.md',
    '.agents/skills/coordinate-approved-tasks/SKILL.md',
    '.agents/skills/verify-changes/SKILL.md',
    '.agents/skills/publish-task-pr/SKILL.md',
    '.agents/skills/handle-github-issue-event/SKILL.md',
    '.agents/skills/handle-github-issue-event/references/issue-protocol.md',
    '.agents/skills/review-changes/SKILL.md',
    '.agents/skills/update-documentation/SKILL.md',
  ];

  for (const file of files) {
    const body = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(body, /実行コンテキスト/, file);
    assert.match(body, /公開モード/, file);
    assert.match(body, /task-execution-policy\.cjs|下流.*引き継|下流skillへ引き継/, file);
  }
});
