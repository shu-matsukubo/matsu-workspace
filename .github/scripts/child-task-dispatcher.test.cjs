'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const dispatcher = require('./child-task-dispatcher.cjs');
const issueFlow = require('./codex-issue-flow.cjs');

const OWNER = Object.freeze({ id: 10, login: 'shu-matsukubo', type: 'User' });
const SOURCE_HASH = 'b'.repeat(64);

function candidate(overrides = {}) {
  return {
    version: 1,
    key: 'T1',
    title: 'T1の実装',
    repository: 'shu-matsukubo/matsu-front',
    priority: 'normal',
    agentStrategy: 'worker-parent-review',
    work: ['承認済みの変更を実装する'],
    outOfScope: ['repository外の変更'],
    completion: ['対象テストが成功する'],
    dependencies: [],
    concerns: [],
    verification: { mode: 'normal', steps: ['unit testを実行する'] },
    documentation: { mode: 'follow-up-only', followUp: [] },
    ...overrides,
  };
}

function semanticPlan(task = candidate(), type = 'plan') {
  return ['<!-- codex-plan-candidate:v1', issueFlow.stringifyMachineJson(task), '-->',
    issueFlow.renderCandidateHuman(task),
    '<!-- /codex-plan-candidate:v1 -->', '',
    `<!-- codex-semantic-result:v1 type=${type} -->`].join('\n');
}

function taskPayload(overrides = {}) {
  const { key = 'T1', approvedPlan: approvedPlanOverride, ...rest } = overrides;
  const approvedPlan = { revision: 2, sha256: 'a'.repeat(64), sourceSha256: SOURCE_HASH,
    sourceOwnerCommentId: 100, ...approvedPlanOverride };
  return {
    version: 1,
    key,
    title: `${key}の実装`,
    repository: 'shu-matsukubo/matsu-front',
    parentIssue: { repository: dispatcher.PARENT_REPOSITORY, number: 42,
      url: 'https://github.com/shu-matsukubo/matsu-workspace/issues/42' },
    approvedPlan,
    priority: 'normal',
    agentStrategy: 'worker-parent-review',
    work: ['承認済みの変更を実装する'],
    outOfScope: ['repository外の変更'],
    completion: ['対象テストが成功する'],
    dependencies: [],
    concerns: [],
    verification: { mode: 'normal', steps: ['unit testを実行する'] },
    cloudPublish: 'commit-and-web-ui-pr',
    documentation: { mode: 'follow-up-only', followUp: [] },
    dispatchId: dispatcher.computeDispatchId(dispatcher.PARENT_REPOSITORY, 42, key, approvedPlan.revision),
    ...rest,
  };
}

function parentFixture({ taskOverrides = {}, dispatchUser = issueFlow.ACTIONS_BOT } = {}) {
  const source = { id: 100, created_at: '2026-08-22T00:00:00Z',
    body: '@codex タスク分解してください', user: { ...OWNER } };
  const planCandidate = candidate(taskOverrides);
  const plan = { id: 110, created_at: '2026-08-22T00:01:00Z',
    body: semanticPlan(planCandidate), user: { ...issueFlow.CODEX_BOT } };
  const issue = { number: 42, title: '親Issue', body: '要件', labels: [] };
  const sourceSha256 = issueFlow.sourceHash({ repository: dispatcher.PARENT_REPOSITORY,
    issue, comments: [source, plan], repositoryOwner: OWNER, sourceOwnerCommentId: source.id });
  const state = {
    version: 1, state: 'approved', revision: 2, handledOwnerCommentId: 120,
    sourceOwnerCommentId: 100, sourceSha256, planSha256: issueFlow.planHash(plan.body),
    planCommentId: 110, resultCommentId: 110, approvalCommentId: 120, dispatchCommentId: 130,
  };
  const stateComment = { id: 115, created_at: '2026-08-22T00:01:30Z',
    body: issueFlow.stateBody(state),
    user: { ...issueFlow.ACTIONS_BOT } };
  const approval = { id: 120, created_at: '2026-08-22T00:02:00Z',
    body: '/codex approve', user: { ...OWNER } };
  const task = issueFlow.projectCandidate(planCandidate, state, 42);
  const marker = { version: 1, revision: 2, approvalCommentId: 120,
    sourceOwnerCommentId: 100, sourceSha256, planSha256: state.planSha256, planCommentId: 110 };
  const dispatch = { id: 130, created_at: '2026-08-22T00:03:00Z',
    body: issueFlow.buildDispatchBody([task], marker), user: { ...dispatchUser } };
  const comments = [source, plan, stateComment, approval, dispatch];
  const payload = {
    repository: { id: 20, full_name: dispatcher.PARENT_REPOSITORY,
      owner: { ...OWNER }, default_branch: 'main' },
    inputs: { issue_number: '42', dispatch_comment_id: '130' },
  };
  return { source, plan, state, stateComment, approval, task, marker, dispatch, comments, payload, issue };
}

function parentGithub(fixture) {
  return {
    paginate: async () => fixture.comments,
    rest: { issues: {
      listComments: async () => ({ data: fixture.comments }),
      get: async () => ({ data: fixture.issue }),
    } },
  };
}

function context(payload) {
  return { eventName: 'workflow_dispatch', payload };
}

function preparedWithTasks(tasks) {
  return {
    version: 1,
    parentIssue: tasks[0].parentIssue,
    approvedPlan: {
      revision: tasks[0].approvedPlan.revision,
      planSha256: tasks[0].approvedPlan.sha256,
      sourceSha256: tasks[0].approvedPlan.sourceSha256,
      sourceOwnerCommentId: tasks[0].approvedPlan.sourceOwnerCommentId,
    },
    tasks,
  };
}

test('Case 5: trusted Actions dispatch and authoritative approved state prepare tasks', async () => {
  const fixture = parentFixture();
  const prepared = await dispatcher.prepareDispatch({ github: parentGithub(fixture),
    context: context(fixture.payload), core: { info() {} } });
  assert.equal(prepared.tasks.length, 1);
  assert.equal(prepared.tasks[0].dispatchId, 'shu-matsukubo/matsu-workspace#42:T1:r2');
  assert.equal(prepared.approvedPlan.planSha256, fixture.state.planSha256);
});

test('dispatch prepare requires the final approved state and rejects approval-verified', async () => {
  const fixture = parentFixture();
  const verified = { ...fixture.state, state: 'approval-verified', dispatchCommentId: null };
  fixture.stateComment.body = issueFlow.stateBody(verified);
  assert.equal(await dispatcher.prepareDispatch({ github: parentGithub(fixture),
    context: context(fixture.payload) }), null);
});

test('owner, Codex bot, and unknown bot cannot trigger Actions dispatch', async () => {
  for (const user of [OWNER, issueFlow.CODEX_BOT, { id: 999, login: 'unknown[bot]', type: 'Bot' }]) {
    const fixture = parentFixture({ dispatchUser: user });
    assert.equal(await dispatcher.prepareDispatch({ github: parentGithub(fixture), context: context(fixture.payload) }), null);
  }
});

test('Pull Request and non-parent repository workflow inputs cannot trigger dispatch', async () => {
  const pullRequest = parentFixture();
  pullRequest.issue.pull_request = { url: 'https://example.test/pr/42' };
  await assert.rejects(dispatcher.prepareDispatch({ github: parentGithub(pullRequest), context: context(pullRequest.payload) }), /親Issue/);
  const otherRepository = parentFixture();
  otherRepository.payload.repository.full_name = 'shu-matsukubo/matsu-front';
  assert.equal(await dispatcher.prepareDispatch({ github: parentGithub(otherRepository), context: context(otherRepository.payload) }), null);
});

test('issue_comment events and forged workflow_dispatch inputs cannot trigger dispatch', async () => {
  const issueComment = parentFixture();
  assert.equal(await dispatcher.prepareDispatch({ github: parentGithub(issueComment),
    context: { eventName: 'issue_comment', payload: issueComment.payload } }), null);
  for (const inputs of [
    { issue_number: '042', dispatch_comment_id: '130' },
    { issue_number: '42', dispatch_comment_id: '999' },
    { issue_number: '42', dispatch_comment_id: '../130' },
  ]) {
    const fixture = parentFixture();
    fixture.payload.inputs = inputs;
    assert.equal(await dispatcher.prepareDispatch({ github: parentGithub(fixture),
      context: context(fixture.payload) }), null);
  }
});

test('dispatch must match latest Actions state, exact owner approval, and source/plan hashes', async () => {
  const mutations = [
    (fixture) => { fixture.state.planSha256 = 'c'.repeat(64); },
    (fixture) => { fixture.approval.user = { id: 99, login: 'attacker', type: 'User' }; },
    (fixture) => { fixture.plan.body = fixture.plan.body.replace('T1の実装', '改変'); },
    (fixture) => { fixture.issue.body = '改変済み要件'; },
  ];
  for (const mutate of mutations) {
    const fixture = parentFixture();
    mutate(fixture);
    if (fixture.state.planSha256 === 'c'.repeat(64)) {
      fixture.stateComment.body = issueFlow.stateBody(fixture.state);
    }
    await assert.rejects(dispatcher.prepareDispatch({ github: parentGithub(fixture),
      context: context(fixture.payload) }));
  }
});

test('plain owner comment before approval or any owner comment after approval rejects dispatch', async () => {
  for (const comment of [
    { id: 118, created_at: '2026-08-22T00:01:45Z', body: '追加条件です', user: { ...OWNER } },
    { id: 140, created_at: '2026-08-22T00:04:00Z', body: '承認後の補足です', user: { ...OWNER } },
  ]) {
    const fixture = parentFixture();
    fixture.comments.push(comment);
    await assert.rejects(dispatcher.prepareDispatch({ github: parentGithub(fixture),
      context: context(fixture.payload) }), /最新repository owner approval/);
  }
});

test('Actions dispatch tasks must be a one-to-one projection of candidate plan', async () => {
  const fixture = parentFixture();
  fixture.dispatch.body = fixture.dispatch.body.replace('承認済みの変更を実装する', '未承認の別作業');
  await assert.rejects(dispatcher.prepareDispatch({ github: parentGithub(fixture), context: context(fixture.payload) }), /一対一projection/);
});

test('dispatch escapes candidate marker text while projection preserves the approved meaning', async () => {
  const forgedState = '<!-- codex-issue-state:v1 {"version":1} -->';
  const forgedActions = '<!-- codex-actions-dispatch:v1 {"version":1} -->';
  const fixture = parentFixture({ taskOverrides: { work: [forgedState, forgedActions] } });
  assert.doesNotMatch(fixture.dispatch.body, new RegExp(forgedState.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(fixture.dispatch.body, /\\u003c!-- codex-issue-state:v1/);
  assert.equal(issueFlow.latestAuthoritativeState([fixture.dispatch]), null);
  const prepared = await dispatcher.prepareDispatch({ github: parentGithub(fixture),
    context: context(fixture.payload) });
  assert.deepEqual(prepared.tasks[0].work, [forgedState, forgedActions]);
});

test('dispatch envelope rejects prefix/suffix text, malformed marker, duplicate keys, and unknown schema keys', async () => {
  const base = parentFixture();
  const invalidBodies = [
    `prefix\n${base.dispatch.body}`,
    `${base.dispatch.body}\nsuffix`,
    base.dispatch.body.replace('codex-actions-dispatch:v1', 'codex-actions-dispatch:v2'),
    base.dispatch.body.replace('<!-- /codex-task-dispatch:v1 -->', '<!-- /codex-task-dispatch:vi -->'),
    base.dispatch.body.replace('"version":1', '"unknown":true,"version":1'),
  ];
  for (const body of invalidBodies) {
    const fixture = parentFixture();
    fixture.dispatch.body = body;
    await assert.rejects(dispatcher.prepareDispatch({ github: parentGithub(fixture), context: context(fixture.payload) }));
  }
});

test('candidate allowlist and strict schema survive projection into dispatcher validation', async () => {
  assert.throws(() => issueFlow.validateCandidateTask(candidate({ repository: 'attacker/repo' })), /allowlist/);
  const task = taskPayload({ repository: 'attacker/repo' });
  assert.throws(() => dispatcher.validatePreparedDispatch(preparedWithTasks([task])), /allowlist/);
  const extra = taskPayload({ unexpected: true });
  assert.throws(() => dispatcher.validatePreparedDispatch(preparedWithTasks([extra])), /schema/);
});

function existingChildIssue(task, overrides = {}) {
  return {
    number: 9,
    html_url: `https://github.com/${task.repository}/issues/9`,
    title: dispatcher.childIssueTitle(task),
    body: dispatcher.buildChildIssueBody(task),
    user: { login: 'shu-matsukubo', type: 'User' },
    author_association: 'OWNER',
    ...overrides,
  };
}

function childGithub(byRepository = {}) {
  const calls = { create: [] };
  return {
    calls,
    paginate: async (_method, args) => byRepository[`${args.owner}/${args.repo}`] || [],
    rest: { issues: {
      listForRepo: async () => ({ data: [] }),
      create: async (args) => {
        calls.create.push(args);
        const repository = `${args.owner}/${args.repo}`;
        const issue = { number: 100 + calls.create.length,
          html_url: `https://github.com/${repository}/issues/${100 + calls.create.length}`,
          title: args.title, body: args.body,
          user: { login: 'shu-matsukubo', type: 'User' }, author_association: 'OWNER' };
        (byRepository[repository] ||= []).push(issue);
        return { data: issue };
      },
    } },
  };
}

test('Case 6: same dispatch-id reuses owner-created child Issue and never duplicates it', async () => {
  const task = taskPayload();
  const existing = existingChildIssue(task);
  const github = childGithub({ [task.repository]: [existing] });
  const result = await dispatcher.dispatchPrepared({ github, prepared: preparedWithTasks([task]) });
  assert.equal(github.calls.create.length, 0);
  assert.equal(result.items[0].outcome, 'reused');
  assert.equal(result.items[0].issueNumber, 9);
});

test('one task creates one Issue and partial rerun only creates the missing task', async () => {
  const first = taskPayload();
  const second = taskPayload({ key: 'T2', repository: 'shu-matsukubo/matsu-bff' });
  const existing = existingChildIssue(first);
  const github = childGithub({ [first.repository]: [existing] });
  const result = await dispatcher.dispatchPrepared({ github, prepared: preparedWithTasks([first, second]) });
  assert.equal(github.calls.create.length, 1);
  assert.equal(github.calls.create[0].repo, 'matsu-bff');
  assert.deepEqual(result.items.map((item) => item.outcome), ['reused', 'created']);
});

test('forged, misplaced, duplicated, or Pull Request child markers are never reused', async () => {
  const task = taskPayload();
  const marker = dispatcher.childIssueMarker(task.dispatchId);
  const candidates = [
    existingChildIssue(task, { user: { login: 'attacker', type: 'User' }, author_association: 'NONE' }),
    existingChildIssue(task, { body: `prefix\n${marker}` }),
    existingChildIssue(task, { body: `${marker}\n${marker}` }),
    existingChildIssue(task, { pull_request: { url: 'https://example.test/pull/9' } }),
  ];
  for (const candidateIssue of candidates) {
    const github = childGithub({ [task.repository]: [candidateIssue] });
    const result = await dispatcher.dispatchPrepared({ github, prepared: preparedWithTasks([task]) });
    assert.equal(github.calls.create.length, 1);
    assert.equal(result.items[0].outcome, 'created');
  }
});

test('child execution packet preserves dependencies and human gate without automatic Codex mention', () => {
  const task = taskPayload({
    dependencies: [{ target: 'shu-matsukubo/matsu-api#20', type: 'hard', gate: 'start',
      completion: '関連Pull Requestがmerged', evidence: 'open at planning time' }],
    work: ['自動起動を追加しない'],
  });
  const body = dispatcher.buildChildIssueBody(task);
  assert.match(body, /shu-matsukubo\/matsu-api#20/);
  assert.match(body, /実装開始直前に依存対象の現在状態をGitHubから再取得/);
  assert.match(body, /packet検証が完了するまで、source・test変更/);
  assert.match(body, /ユーザー.*確認|内容を確認後/);
  assert.doesNotMatch(body, /@codex/i);
  assert.match(body, /実行コンテキスト: `issue-cloud`/);
  assert.match(body, /公開モード: `codex-web-ui`/);
});

test('reviewer strategy and explicit documentation mode remain in the human execution packet', () => {
  const task = taskPayload({
    agentStrategy: 'worker-reviewer-parent',
    documentation: { mode: 'explicit-update', followUp: ['対象: AGENTS.md'] },
  });
  dispatcher.validatePreparedDispatch(preparedWithTasks([task]));
  const body = dispatcher.buildChildIssueBody(task);
  assert.match(body, /独立Reviewer/);
  assert.match(body, /mode: `explicit-update`/);
  assert.match(body, /documentation本文の更新が承認範囲に明示的に含まれています/);
});

test('token boundary fails safely and never prints the token', () => {
  assert.throws(() => dispatcher.requireCrossRepoToken(''), /not configured/);
  const secret = 'sensitive-test-token-value-that-must-not-leak';
  assert.equal(dispatcher.requireCrossRepoToken(secret), true);
  assert.doesNotMatch(dispatcher.requireCrossRepoToken.toString(), new RegExp(secret));
  const first = taskPayload();
  const second = taskPayload({ key: 'T2', repository: 'shu-matsukubo/matsu-bff' });
  const result = dispatcher.missingTokenDispatchResult(preparedWithTasks([first, second]));
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.failures.map((failure) => failure.taskKey), ['T1', 'T2']);
});

function trackingGithub(comments, initialState = 'Codex:処理中') {
  const labels = new Set([initialState]);
  const calls = { create: [], update: [], removeLabel: [], addLabels: [] };
  return {
    calls,
    paginate: async () => comments,
    rest: { issues: {
      listComments: async () => ({ data: comments }),
      createComment: async (args) => { calls.create.push(args); const comment = { id: 300, body: args.body,
        created_at: '2026-08-22T00:04:00Z', user: { ...issueFlow.ACTIONS_BOT } }; comments.push(comment); return { data: comment }; },
      updateComment: async (args) => { calls.update.push(args); return { data: { id: args.comment_id } }; },
      getLabel: async () => ({ data: {} }), createLabel: async () => ({ data: {} }),
      get: async () => ({ data: { labels: [...labels].map((name) => ({ name })) } }),
      removeLabel: async (args) => { calls.removeLabel.push(args); labels.delete(args.name); },
      addLabels: async (args) => { calls.addLabels.push(args); args.labels.forEach((label) => labels.add(label)); },
    } },
  };
}

test('tracking remains idempotent and syncs final state only for current approved dispatch', async () => {
  const fixture = parentFixture();
  const prepared = preparedWithTasks([fixture.task]);
  const result = { version: 1, items: [{ taskKey: 'T1', repository: fixture.task.repository,
    issueNumber: 9, url: 'https://github.com/shu-matsukubo/matsu-front/issues/9', outcome: 'reused' }], failures: [] };
  const tracking = { id: 200, created_at: '2026-08-22T00:04:00Z',
    body: dispatcher.trackingMarker(prepared), user: { ...issueFlow.ACTIONS_BOT } };
  fixture.comments.push(tracking);
  const github = trackingGithub(fixture.comments);
  const outcome = await dispatcher.upsertTrackingComment({ github, prepared, result,
    context: context(fixture.payload), core: { info() {} } });
  assert.deepEqual(outcome, { outcome: 'updated', commentId: 200 });
  assert.equal(github.calls.create.length, 0);
  assert.equal(github.calls.update.length, 1);
  assert.doesNotMatch(github.calls.update[0].body, /@codex/i);
  assert.deepEqual(github.calls.addLabels.map((call) => call.labels), [['Codex:子タスク確認待ち']]);
});

test('malformed trusted Actions dispatch gets generic idempotent failure tracking without input leakage', async () => {
  const fixture = parentFixture();
  fixture.dispatch.body = 'secret-malformed-input';
  const github = trackingGithub(fixture.comments);
  await assert.rejects(dispatcher.prepareDispatch({ github: parentGithub(fixture),
    context: context(fixture.payload) }), /version 1 task block/);
  const first = await dispatcher.upsertPreparationFailure({ github, context: context(fixture.payload), core: { info() {} } });
  const second = await dispatcher.upsertPreparationFailure({ github, context: context(fixture.payload), core: { info() {} } });
  assert.deepEqual(first, { outcome: 'created', commentId: 300 });
  assert.deepEqual(second, { outcome: 'updated', commentId: 300 });
  assert.equal(github.calls.create.length, 1);
  assert.doesNotMatch(github.calls.create[0].body, /secret-malformed-input/);
  assert.match(github.calls.create[0].body, /検証エラーの詳細や認証情報はこのコメントへ記録していません/);
  assert.doesNotMatch(github.calls.create[0].body, /@codex/i);
  assert.deepEqual(github.calls.addLabels.map((call) => call.labels), [['Codex:要判断']]);
});

test('untrusted dispatch never gets an Actions failure comment', async () => {
  const fixture = parentFixture({ dispatchUser: { id: 999, login: 'unknown[bot]', type: 'Bot' } });
  const github = trackingGithub(fixture.comments);
  const result = await dispatcher.upsertPreparationFailure({ github, context: context(fixture.payload) });
  assert.equal(result, null);
  assert.equal(github.calls.create.length, 0);
});

test('new owner comment prevents stale dispatch failure tracking and label updates', async () => {
  const fixture = parentFixture();
  fixture.dispatch.body = 'broken-current-dispatch';
  fixture.comments.push({ id: 140, created_at: '2026-08-22T00:04:00Z',
    body: '承認後の追加条件です', user: { ...OWNER } });
  const github = trackingGithub(fixture.comments);
  const result = await dispatcher.upsertPreparationFailure({ github, context: context(fixture.payload) });
  assert.equal(result, null);
  assert.equal(github.calls.create.length, 0);
  assert.equal(github.calls.addLabels.length, 0);
});

test('new owner revise after dispatch prevents an old rerun from overwriting current label', async () => {
  const fixture = parentFixture();
  fixture.comments.push({ id: 140, created_at: '2026-08-22T00:04:00Z',
    body: '@codex 計画を変更してください', user: { ...OWNER } });
  const prepared = preparedWithTasks([fixture.task]);
  const result = { version: 1, items: [{ taskKey: 'T1', repository: fixture.task.repository,
    issueNumber: 9, url: 'https://example.test/9', outcome: 'reused' }], failures: [] };
  const github = trackingGithub(fixture.comments, 'Codex:PR作成済');
  await dispatcher.upsertTrackingComment({ github, prepared, result,
    context: context(fixture.payload), core: { info() {} } });
  assert.deepEqual(github.calls.removeLabel, []);
  assert.deepEqual(github.calls.addLabels, []);
});

test('dispatcher workflow preserves separated token scopes and generic failure handling', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'child-task-dispatcher.yml'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, 'child-task-dispatcher.cjs'), 'utf8');
  assert.match(workflow, /github\.repository == 'shu-matsukubo\/matsu-workspace'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /issue_number:[\s\S]*dispatch_comment_id:/);
  assert.doesNotMatch(workflow, /issue_comment:/);
  assert.match(source, /authoritative\.state\.state === 'approved'/);
  assert.doesNotMatch(source, /authoritative\.state\.state === 'approval-verified'/);
  assert.match(workflow, /CROSS_REPO_ISSUE_TOKEN/);
  assert.match(workflow, /github-token: \$\{\{ secrets\.CROSS_REPO_ISSUE_TOKEN \}\}/);
  assert.match(workflow, /github-token: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /missingTokenDispatchResult/);
  assert.match(workflow, /upsertPreparationFailure/);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY|codex-action/);
  assert.match(workflow, /persist-credentials: false/);
});

test('allowlist contains only the eight current child repositories', () => {
  assert.deepEqual(dispatcher.ALLOWED_REPOSITORIES, issueFlow.ALLOWED_REPOSITORIES);
  assert.equal(dispatcher.ALLOWED_REPOSITORIES.length, 8);
});
