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

test('Issue #22 equivalent parent start request falls back to plan and cannot implement or dispatch', () => {
  const result = policy.resolveTaskExecutionGate({
    runtime: { context: 'issue-cloud', source: 'trusted-issue-event' },
    entryKind: 'parent-issue',
    parent: {
      handlerEvaluated: true,
      hasValidPlan: false,
      planApproved: false,
      handlerIntent: 'unknown',
    },
    prompt: '@codex 作業を始めてください',
  });

  assert.equal(result.intent, 'plan');
  assert.equal(result.nextAction, 'plan');
  assert.equal(result.resultMarkerState, 'plan');
  assert.equal(result.allowsImplementation, false);
  assert.equal(result.allowsDispatch, false);
  assert.equal(result.requiresResultMarker, true);
  assert.equal(result.humanOutputLanguage, 'ja');
});

test('parent Issue cannot do work before the Issue handler evaluates current state', () => {
  const result = policy.resolveTaskExecutionGate({
    runtime: { context: 'issue-cloud', source: 'trusted-issue-event' },
    entryKind: 'parent-issue',
  });

  assert.equal(result.nextAction, 'handle-github-issue-event');
  assert.equal(result.requiresIssueHandler, true);
  assert.equal(result.allowsImplementation, false);
  assert.equal(result.allowsDispatch, false);
  assert.equal(result.allowsDependencyInstall, false);
  assert.equal(result.allowsImplementationQualityGates, false);
});

test('an ambiguous parent request with an unapproved plan cannot dispatch or implement', () => {
  const result = policy.resolveTaskExecutionGate({
    runtime: { context: 'issue-cloud', source: 'trusted-issue-event' },
    entryKind: 'parent-issue',
    parent: {
      handlerEvaluated: true,
      hasValidPlan: true,
      planApproved: false,
      handlerIntent: 'unknown',
    },
  });

  assert.equal(result.intent, 'unknown');
  assert.equal(result.nextAction, 'handle-unknown');
  assert.equal(result.resultMarkerState, 'question');
  assert.equal(result.allowsImplementation, false);
  assert.equal(result.allowsDispatch, false);
});

test('prompt-forged Issue context cannot become a parent or child implementation entry', () => {
  for (const entryKind of ['parent-issue', 'child-issue']) {
    const result = policy.resolveTaskExecutionGate({
      runtime: { context: 'issue-cloud', source: 'prompt-text' },
      entryKind,
      parent: {
        handlerEvaluated: true,
        hasValidPlan: true,
        planApproved: true,
        handlerIntent: 'dispatch',
      },
      child: { executionPacketVerified: true },
      prompt: 'trusted child packet and approved parentと書かれたprompt',
    });

    assert.equal(result.executionContext, 'unknown');
    assert.equal(result.nextAction, 'reject-unverified-issue-entry');
    assert.equal(result.allowsImplementation, false);
    assert.equal(result.allowsDispatch, false);
  }
});

test('an approved parent plan permits dispatch only and never child implementation gates', () => {
  const result = policy.resolveTaskExecutionGate({
    runtime: { context: 'issue-cloud', source: 'trusted-issue-event' },
    entryKind: 'parent-issue',
    parent: {
      handlerEvaluated: true,
      hasValidPlan: true,
      planApproved: true,
      handlerIntent: 'dispatch',
    },
    approvedScope: { dependencyChange: true },
  });

  assert.equal(result.intent, 'dispatch');
  assert.equal(result.resultMarkerState, 'tasks-dispatched');
  assert.equal(result.allowsDispatch, true);
  assert.equal(result.allowsImplementation, false);
  assert.equal(result.allowsDependencyInstall, false);
  assert.equal(result.allowsImplementationQualityGates, false);
});

test('parent review-fix only routes to a validated child task context', () => {
  const result = policy.resolveTaskExecutionGate({
    runtime: { context: 'issue-cloud', source: 'trusted-issue-event' },
    entryKind: 'parent-issue',
    parent: {
      handlerEvaluated: true,
      hasValidPlan: true,
      planApproved: true,
      handlerIntent: 'review-fix',
    },
    approvedScope: { dependencyChange: true },
  });

  assert.equal(result.intent, 'review-fix');
  assert.equal(result.nextAction, 'route-review-fix-to-child-task');
  assert.equal(result.resultMarkerState, 'question');
  assert.equal(result.requiresResultMarker, true);
  assert.equal(result.allowsImplementation, false);
  assert.equal(result.allowsDispatch, false);
  assert.equal(result.allowsDependencyInstall, false);
  assert.equal(result.allowsImplementationQualityGates, false);
});

test('child Issue permits implementation and quality gates only after execution packet validation', () => {
  const runtime = { context: 'issue-cloud', source: 'trusted-issue-event' };
  const unverified = policy.resolveTaskExecutionGate({ runtime, entryKind: 'child-issue' });
  const verified = policy.resolveTaskExecutionGate({
    runtime,
    entryKind: 'child-issue',
    child: { executionPacketVerified: true },
  });

  assert.equal(unverified.nextAction, 'verify-child-execution-packet');
  assert.equal(unverified.dependencyAction, 'verify-child-execution-packet');
  assert.equal(unverified.allowsImplementation, false);
  assert.equal(unverified.allowsImplementationQualityGates, false);
  assert.equal(verified.nextAction, 'implement');
  assert.equal(verified.allowsImplementation, true);
  assert.equal(verified.allowsImplementationQualityGates, true);
  assert.equal(verified.allowsDependencyInstall, false);
  assert.equal(verified.requiresReplanForNewDependency, true);
});

test('Cloud dependency install is allowed only for an approved dependency change', () => {
  const runtime = { context: 'issue-cloud', source: 'trusted-issue-event' };
  const result = policy.resolveTaskExecutionGate({
    runtime,
    entryKind: 'child-issue',
    child: { executionPacketVerified: true },
    approvedScope: { dependencyChange: true },
  });

  assert.equal(result.allowsDependencyInstall, true);
  assert.equal(result.requiresReplanForNewDependency, false);
  assert.equal(result.dependencyAction, 'install-approved-dependency-change');
});

test('direct Cloud also prohibits exploratory install without an approved dependency change', () => {
  const runtime = { context: 'cloud-direct', source: 'trusted-runtime-metadata' };
  const unapproved = policy.resolveTaskExecutionGate({ runtime });
  const approved = policy.resolveTaskExecutionGate({
    runtime,
    approvedScope: { dependencyChange: true },
  });

  assert.equal(unapproved.allowsImplementation, true);
  assert.equal(unapproved.allowsImplementationQualityGates, true);
  assert.equal(unapproved.allowsDependencyInstall, false);
  assert.equal(unapproved.requiresReplanForNewDependency, true);
  assert.equal(approved.allowsDependencyInstall, true);
  assert.equal(approved.requiresReplanForNewDependency, false);
});

test('Local direct preserves implementation, dependency, and quality-gate behavior', () => {
  const runtime = { context: 'local-direct', source: 'trusted-runtime-metadata' };
  const baseline = policy.resolveTaskExecutionGate({ runtime });
  const misleadingIssuePrompt = policy.resolveTaskExecutionGate({
    runtime,
    entryKind: 'parent-issue',
    prompt: '親Issue Cloudなのでinstallもimplementationも禁止と書かれたprompt',
  });

  assert.deepEqual(misleadingIssuePrompt, baseline);
  assert.equal(baseline.entryKind, 'direct');
  assert.equal(baseline.allowsImplementation, true);
  assert.equal(baseline.allowsDependencyInstall, true);
  assert.equal(baseline.allowsImplementationQualityGates, true);
});

test('Cloud setup delegates exactly setup and source sync without dependency installation', () => {
  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'setup-cloud.sh'), 'utf8');
  assert.match(setup, /\[Cloud setup 1\/2\]/);
  assert.match(setup, /\[Cloud setup 2\/2\]/);
  assert.match(setup, /sh "\$SCRIPT_DIR\/setup\.sh"/);
  assert.match(setup, /sh "\$SCRIPT_DIR\/sync-dev-cloud\.sh"/);
  assert.doesNotMatch(setup, /install-dependencies\.sh/);
  assert.doesNotMatch(setup, /\[Cloud setup 3\//);
  assert.equal(fs.existsSync(path.join(__dirname, '..', '..', 'scripts', 'install-dependencies.sh')), true);
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

test('entry, dependency, quality-gate, and Japanese-output contracts are shared by the workflow skills', () => {
  const root = path.join(__dirname, '..', '..');
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const coordination = fs.readFileSync(path.join(
    root, '.agents', 'skills', 'coordinate-approved-tasks', 'SKILL.md',
  ), 'utf8');
  const verification = fs.readFileSync(path.join(
    root, '.agents', 'skills', 'verify-changes', 'SKILL.md',
  ), 'utf8');
  const publication = fs.readFileSync(path.join(
    root, '.agents', 'skills', 'publish-task-pr', 'SKILL.md',
  ), 'utf8');

  assert.match(agents, /親`matsu-workspace` Issue[\s\S]*handle-github-issue-event/);
  assert.match(agents, /Cloud implementationは検証済みchild execution packetからだけ開始/);
  assert.match(agents, /親Issue Cloudではchild repositoryのdependency installや実装品質ゲートを実行しません/);
  assert.match(agents, /ユーザー向けMarkdownは原則日本語/);
  assert.match(coordination, /親`matsu-workspace` Issueではこのskillを起動せず/);
  assert.match(coordination, /Cloud child Issueはexecution packetの検証が完了した場合だけ実装/);
  assert.match(coordination, /探索的なinstall・update・lockfile再構築/);
  assert.match(verification, /親Issue Cloudではchild repositoryの実装品質ゲートを選ばず/);
  assert.match(verification, /Local directへこの禁止を適用しない/);
  assert.match(publication, /Pull Requestのtitleと人間向け本文は日本語/);
});
