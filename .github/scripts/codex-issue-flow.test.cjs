'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const flow = require('./codex-issue-flow.cjs');

const OWNER = Object.freeze({ id: 10, login: 'shu-matsukubo', type: 'User' });
const OTHER = Object.freeze({ id: 11, login: 'other', type: 'User' });

function candidate(overrides = {}) {
  return {
    version: 1,
    key: 'T1',
    title: '認証境界を修正する',
    repository: 'shu-matsukubo/matsu-bff',
    priority: 'normal',
    agentStrategy: 'worker-parent-review',
    work: ['承認済み責務を実装する'],
    outOfScope: ['親Issueから直接実装すること'],
    completion: ['対象テストが成功する'],
    dependencies: [],
    concerns: ['境界を弱めない'],
    verification: { mode: 'normal', steps: ['unit testを実行する'] },
    documentation: { mode: 'follow-up-only', followUp: [] },
    ...overrides,
  };
}

function semanticPlan(task = candidate(), type = 'plan') {
  return [
    '<!-- codex-plan-candidate:v1',
    flow.stringifyMachineJson(task),
    '-->',
    flow.renderCandidateHuman(task),
    '<!-- /codex-plan-candidate:v1 -->',
    '',
    `<!-- codex-semantic-result:v1 type=${type} -->`,
  ].join('\n');
}

function withConnectorFooter(body, taskId = 'example', leadingSpace = '') {
  return `${body}\n\n${leadingSpace}[View task →](https://chatgpt.com/s/${taskId})`;
}

function ownerCommand(overrides = {}) {
  return {
    id: 100,
    created_at: '2026-08-22T00:00:00Z',
    body: '@codex 作業を開始してください',
    user: { ...OWNER },
    ...overrides,
  };
}

function payload(comment, overrides = {}) {
  return {
    action: 'created',
    repository: {
      id: 20,
      full_name: flow.PARENT_REPOSITORY,
      owner: { ...OWNER },
      default_branch: 'main',
    },
    sender: comment.user,
    issue: { id: 30, number: 24, title: 'Issue #24相当', body: '要件本文', labels: [] },
    comment,
    ...overrides,
  };
}

function context(eventPayload, eventName = 'issue_comment') {
  return { eventName, payload: eventPayload, repo: { owner: 'shu-matsukubo', repo: 'matsu-workspace' } };
}

function fakeGithub(initialComments = [], { labels = [], nextIds = [] } = {}) {
  const comments = initialComments;
  const labelSet = new Set(labels);
  const calls = { addLabels: [], createComment: [], updateComment: [], removeLabel: [], createLabel: [],
    deleteLabel: [], createWorkflowDispatch: [], sequence: [] };
  let generatedId = 1000;
  const nextId = () => nextIds.shift() || generatedId++;
  return {
    comments,
    calls,
    paginate: async () => comments,
    rest: { issues: {
      listComments: async () => ({ data: comments }),
      get: async () => ({ data: {
        number: 24,
        title: 'Issue #24相当',
        body: '要件本文',
        labels: [...labelSet].map((name) => ({ name })),
      } }),
      getLabel: async () => ({ data: {} }),
      createLabel: async (args) => { calls.createLabel.push(args); },
      deleteLabel: async (args) => { calls.deleteLabel.push(args); },
      addLabels: async (args) => { calls.addLabels.push(args); args.labels.forEach((label) => labelSet.add(label)); },
      removeLabel: async (args) => { calls.removeLabel.push(args); labelSet.delete(args.name); },
      createComment: async (args) => {
        calls.createComment.push(args);
        calls.sequence.push('create-comment');
        const comment = {
          id: nextId(),
          created_at: `2026-08-22T00:${String(comments.length + 1).padStart(2, '0')}:00Z`,
          body: args.body,
          user: { ...flow.ACTIONS_BOT },
        };
        comments.push(comment);
        return { data: comment };
      },
      updateComment: async (args) => {
        calls.updateComment.push(args);
        calls.sequence.push('update-comment');
        const comment = comments.find((item) => item.id === args.comment_id);
        if (comment) comment.body = args.body;
        return { data: comment };
      },
    }, actions: {
      createWorkflowDispatch: async (args) => {
        calls.createWorkflowDispatch.push(args);
        calls.sequence.push('workflow-dispatch');
        return { status: 204 };
      },
    } },
  };
}

const core = { info() {}, warning() {} };

test('metadata-free semantic plan contract contains task meaning but no GitHub authoritative metadata', () => {
  const parsed = flow.parseSemanticResult(semanticPlan());
  assert.equal(parsed.type, 'plan');
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].key, 'T1');
  for (const forbidden of ['parentIssue', 'approvedPlan', 'dispatchId', 'commentId', 'revision', 'sourceSha256', 'planSha256']) {
    assert.equal(Object.hasOwn(parsed.candidates[0], forbidden), false, forbidden);
  }
  assert.throws(() => flow.parseSemanticResult(semanticPlan(candidate({ revision: 9 }))), /schema/);
});

test('candidate human rendering deterministically exposes every approved field and must match machine payload', () => {
  const task = candidate({
    title: '<境界> & @codex `確認`',
    work: ['machine workだけの改変を許さない'],
    dependencies: [{ target: 'shu-matsukubo/matsu-api#1', type: 'hard', gate: 'start',
      completion: 'PRがmerged', evidence: '計画時はopen' }],
  });
  const human = flow.renderCandidateHuman(task);
  const visibleJson = /^## [^\n]+\n\n承認対象task payload\n\n```json\n([\s\S]+)\n```$/.exec(human)[1];
  assert.deepEqual(JSON.parse(visibleJson), task);
  assert.doesNotMatch(human, /@codex|<!--|-->/i);
  assert.match(human, /\\u003c境界\\u003e/);
  assert.match(human, /\\u0026|\\u0040|\\u0060/);

  const changedMachine = flow.stringifyMachineJson({ ...task, work: ['hidden machineだけ改変'] });
  const mismatched = semanticPlan(task).replace(flow.stringifyMachineJson(task), changedMachine);
  assert.throws(() => flow.parseSemanticResult(mismatched), /人間向け表示全体/);
});

test('semantic candidate grammar is strict and supports revise, question, and error', () => {
  assert.equal(flow.parseSemanticResult(semanticPlan(candidate(), 'revise')).type, 'revise');
  assert.equal(flow.parseSemanticResult('確認が必要です。\n\n<!-- codex-semantic-result:v1 type=question -->').type, 'question');
  assert.equal(flow.parseSemanticResult('処理できません。\n\n<!-- codex-semantic-result:v1 type=error -->').type, 'error');
  assert.throws(() => flow.parseSemanticResult(`prefix\n${semanticPlan()}`), /開始/);
  assert.throws(() => flow.parseSemanticResult(semanticPlan(candidate({ repository: 'attacker/repo' }))), /allowlist/);
  assert.throws(() => flow.parseSemanticResult(`<!-- codex-semantic-result:v1 type=question -->\n\n質問\n\n<!-- codex-semantic-result:v1 type=question -->`), /1つだけ/);
  assert.throws(() => flow.parseSemanticResult('<!-- codex-plan-candidate:v1 -->\n\n<!-- codex-semantic-result:v1 type=question -->'), /予約marker/);
  assert.throws(() => flow.parseSemanticResult('<!-- codex-semantic-result:v1 type=bogus -->\n\n<!-- codex-semantic-result:v1 type=error -->'), /予約marker/);
  for (const reserved of [
    '<!-- codex-issue-state:v1 {} -->',
    '<!-- codex-actions-dispatch:v1 {} -->',
  ]) {
    for (const type of ['question', 'error']) {
      assert.throws(() => flow.parseSemanticResult(`${reserved}\n\n<!-- codex-semantic-result:v1 type=${type} -->`), /予約marker/);
    }
  }
});

test('strict Connector footer suffix is supported for every semantic result type', () => {
  assert.equal(flow.parseSemanticResult(withConnectorFooter(semanticPlan())).type, 'plan');
  assert.equal(flow.parseSemanticResult(withConnectorFooter(semanticPlan(), 'task-spaced', ' ')).type, 'plan');
  assert.equal(flow.parseSemanticResult(withConnectorFooter(semanticPlan(candidate(), 'revise'), 'task_ABC-123')).type, 'revise');
  assert.equal(flow.parseSemanticResult(withConnectorFooter(
    '確認が必要です。\n\n<!-- codex-semantic-result:v1 type=question -->')).type, 'question');
  assert.equal(flow.parseSemanticResult(withConnectorFooter(
    '処理できません。\n\n<!-- codex-semantic-result:v1 type=error -->')).type, 'error');
  const crlfPlan = `${withConnectorFooter(semanticPlan(), 'task-crlf').replace(/\n/g, '\r\n')}\r\n`;
  assert.equal(flow.parseSemanticResult(crlfPlan).type, 'plan');

  const malformedSuffixes = [
    '任意の文章',
    '[View task →](http://chatgpt.com/s/example)',
    '[View task →](https://example.com/s/example)',
    '[View task →](https://user@chatgpt.com/s/example)',
    '[View task →](https://chatgpt.com:443/s/example)',
    '[View task →](https://chatgpt.com/s/example?query=1)',
    '[View task →](https://chatgpt.com/s/example#fragment)',
    '[View task →](https://chatgpt.com/s/example/extra)',
    '[View task →](https://chatgpt.com/s/example%2Fextra)',
    '[View task ->](https://chatgpt.com/s/example)',
    '  [View task →](https://chatgpt.com/s/example)',
    '\t[View task →](https://chatgpt.com/s/example)',
    '　[View task →](https://chatgpt.com/s/example)',
  ];
  for (const suffix of malformedSuffixes) {
    assert.throws(() => flow.parseSemanticResult(`${semanticPlan()}\n\n${suffix}`), /footer/);
  }
  assert.throws(() => flow.parseSemanticResult(
    `${withConnectorFooter(semanticPlan())}\n\n追加content`), /footer/);
  assert.throws(() => flow.parseSemanticResult(
    `${semanticPlan()}\n[View task →](https://chatgpt.com/s/example)`), /footer/);
  assert.throws(() => flow.parseSemanticResult(
    `${semanticPlan()}\n\n\n[View task →](https://chatgpt.com/s/example)`), /footer/);
  assert.throws(() => flow.parseSemanticResult(
    `${semanticPlan()}\n<!-- codex-semantic-result:v1 type=plan -->\n\n[View task →](https://chatgpt.com/s/example)`), /1つだけ/);
  assert.throws(() => flow.parseSemanticResult(
    `${semanticPlan()}\n\n[View task →](https://chatgpt.com/s/example<!-- codex-issue-state:v1 {} -->)`), /footer/);
  const mismatched = withConnectorFooter(semanticPlan(candidate()).replace('対象テストが成功する', '表示だけ改変'));
  assert.throws(() => flow.parseSemanticResult(mismatched), /人間向け表示全体/);
});

test('Connector footer is excluded from plan identity while the footerless legacy hash is unchanged', () => {
  const plan = semanticPlan();
  const legacyNormalized = plan.split('\n').map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n').replace(/^\n+|\n+$/g, '');
  const legacyHash = crypto.createHash('sha256').update(legacyNormalized, 'utf8').digest('hex');
  assert.equal(flow.planHash(plan), legacyHash);
  assert.equal(flow.planHash(withConnectorFooter(plan, 'task-one')), legacyHash);
  assert.equal(flow.planHash(withConnectorFooter(plan, 'task-two')), legacyHash);
  assert.equal(flow.planHash(withConnectorFooter(plan, 'task-spaced', ' ')), legacyHash);
  assert.equal(flow.planHash(`${withConnectorFooter(plan, 'task-crlf').replace(/\n/g, '\r\n')}\r\n`), legacyHash);
});

test('only repository owner @codex and exact owner approval are trusted control inputs', () => {
  const command = ownerCommand();
  assert.equal(flow.isTrustedOwnerCommand(command, OWNER), true);
  assert.equal(flow.isTrustedOwnerCommand({ ...command, user: OTHER }, OWNER), false);
  assert.equal(flow.isExactApprovalCommand('/codex approve'), true);
  assert.equal(flow.isExactApprovalCommand(' /codex approve\n'), true);
  assert.equal(flow.isExactApprovalCommand('/codex approve now'), false);
  assert.equal(flow.isTrustedOwnerApproval({ ...command, body: '/codex approve' }, OWNER), true);
  assert.equal(flow.isTrustedOwnerApproval({ ...command, body: '/codex approve', user: OTHER }, OWNER), false);
});

test('Case 2 and 3: unknown user, unknown bot, and Pull Request comment cannot change control state', async () => {
  const attempts = [
    payload({ ...ownerCommand(), user: OTHER }),
    payload({ ...ownerCommand(), user: { id: 999, login: 'unknown[bot]', type: 'Bot' }, body: semanticPlan() }),
    payload(ownerCommand(), { issue: { number: 24, pull_request: { url: 'https://example.test/pr/24' } } }),
    payload(ownerCommand(), { repository: { id: 21, full_name: 'shu-matsukubo/matsu-front', owner: { ...OWNER } } }),
  ];
  for (const item of attempts) {
    const github = fakeGithub([item.comment], { labels: ['Codex:承認待ち'] });
    await flow.run({ github, context: context(item), core });
    assert.equal(github.calls.addLabels.length, 0);
    assert.equal(github.calls.removeLabel.length, 0);
    assert.equal(github.calls.createComment.length, 0);
  }
});

test('owner @codex command is verified by Actions and only marks processing', async () => {
  const command = ownerCommand();
  const github = fakeGithub([command], { labels: ['Codex:承認待ち'] });
  await flow.run({ github, context: context(payload(command)), core });
  assert.deepEqual(github.calls.removeLabel.map((call) => call.name), ['Codex:承認待ち']);
  assert.deepEqual(github.calls.addLabels.map((call) => call.labels), [['Codex:処理中']]);
  assert.equal(github.calls.createComment.length, 0);
});

test('Case 1: Issue #24 equivalent native result without metadata becomes an Actions-authored revision 1 plan', async () => {
  const command = ownerCommand();
  const result = { id: 110, created_at: '2026-08-22T00:01:00Z', body: semanticPlan(), user: { ...flow.CODEX_BOT } };
  const github = fakeGithub([command, result], { labels: ['Codex:処理中'], nextIds: [115] });
  await flow.run({ github, context: context(payload(result)), core });
  assert.equal(github.calls.createComment.length, 1);
  const state = flow.authoritativeStateMarker(github.calls.createComment[0].body);
  assert.equal(state.state, 'awaiting-approval');
  assert.equal(state.revision, 1);
  assert.equal(state.handledOwnerCommentId, 100);
  assert.equal(state.planCommentId, 110);
  assert.match(state.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(state.planSha256, flow.planHash(result.body));
  assert.match(github.calls.createComment[0].body, /完全一致の `\/codex approve`/);
  assert.doesNotMatch(result.body, /revision|comment-id|sha256/);
});

test('Issue #26 equivalent Connector footer plan becomes an awaiting-approval state', async () => {
  const command = ownerCommand();
  const result = { id: 110, created_at: '2026-08-22T00:01:00Z',
    body: withConnectorFooter(semanticPlan(), 'cd_6a89c0bb19408191bd6d4e6679cc63fb', ' '),
    user: { ...flow.CODEX_BOT } };
  const github = fakeGithub([command, result], { labels: ['Codex:処理中'], nextIds: [115] });
  await flow.run({ github, context: context(payload(result)), core });
  assert.equal(github.calls.createComment.length, 1);
  const state = flow.authoritativeStateMarker(github.calls.createComment[0].body);
  assert.equal(state.state, 'awaiting-approval');
  assert.equal(state.planSha256, flow.planHash(semanticPlan()));
  assert.deepEqual(github.calls.addLabels.map((call) => call.labels), [['Codex:承認待ち']]);
});

test('trusted but malformed semantic plan is recorded as a Japanese Actions error state', async () => {
  const command = ownerCommand();
  const malformed = { id: 110, created_at: '2026-08-22T00:01:00Z',
    body: `${semanticPlan()}\ninvalid suffix\n<!-- codex-semantic-result:v1 type=plan -->`,
    user: { ...flow.CODEX_BOT } };
  const github = fakeGithub([command, malformed], { labels: ['Codex:処理中'], nextIds: [115] });
  await flow.run({ github, context: context(payload(malformed)), core });
  assert.equal(github.calls.createComment.length, 1);
  const state = flow.authoritativeStateMarker(github.calls.createComment[0].body);
  assert.equal(state.state, 'error');
  assert.equal(state.planSha256, null);
  assert.match(github.calls.createComment[0].body, /要判断/);
});

function authoritativePlanFixture({ revision = 1, resultType = 'plan', planBody = null } = {}) {
  const command = ownerCommand();
  const plan = { id: 110, created_at: '2026-08-22T00:01:00Z',
    body: planBody || semanticPlan(candidate(), resultType), user: { ...flow.CODEX_BOT } };
  const issue = { number: 24, title: 'Issue #24相当', body: '要件本文', labels: [] };
  const sourceSha256 = flow.sourceHash({ repository: flow.PARENT_REPOSITORY, issue,
    comments: [command, plan], repositoryOwner: OWNER, sourceOwnerCommentId: command.id });
  const state = {
    version: 1,
    state: 'awaiting-approval',
    revision,
    handledOwnerCommentId: command.id,
    sourceOwnerCommentId: command.id,
    sourceSha256,
    planSha256: flow.planHash(plan.body),
    planCommentId: plan.id,
    resultCommentId: plan.id,
    approvalCommentId: null,
    dispatchCommentId: null,
  };
  const stateComment = {
    id: 115,
    created_at: '2026-08-22T00:01:30Z',
    body: flow.stateBody(state),
    user: { ...flow.ACTIONS_BOT },
  };
  return { command, plan, state, stateComment };
}

test('authoritative state requires one terminal marker and the exact Actions state body grammar', () => {
  const fixture = authoritativePlanFixture();
  const valid = flow.stateBody(fixture.state);
  assert.deepEqual(flow.authoritativeStateMarker(valid), fixture.state);
  for (const injected of [
    `tracking prefix\n${valid}\ntracking suffix`,
    `${valid}\n${valid}`,
    valid.replace('## Codex計画: 承認待ち', '## forged tracking'),
  ]) {
    assert.equal(flow.authoritativeStateMarker(injected), null);
    const actionsComment = { id: 999, created_at: '2026-08-22T00:10:00Z',
      body: injected, user: { ...flow.ACTIONS_BOT } };
    assert.equal(flow.latestAuthoritativeState([actionsComment]), null);
  }
});

test('Case 6: same owner comment and plan hash rerun does not increment revision or duplicate state', async () => {
  const fixture = authoritativePlanFixture();
  const github = fakeGithub([fixture.command, fixture.plan, fixture.stateComment], { labels: ['Codex:処理中'] });
  await flow.run({ github, context: context(payload(fixture.plan)), core });
  assert.equal(github.calls.createComment.length, 0);
  assert.equal(github.calls.updateComment.length, 0);
  assert.deepEqual(github.calls.addLabels.map((call) => call.labels), [['Codex:承認待ち']]);
});

test('Connector URL-only plan rerun keeps the existing revision and authoritative state', async () => {
  const fixture = authoritativePlanFixture({ planBody: withConnectorFooter(semanticPlan(), 'task-one') });
  const equivalent = { id: 116, created_at: '2026-08-22T00:02:00Z',
    body: withConnectorFooter(semanticPlan(), 'task-two'), user: { ...flow.CODEX_BOT } };
  const github = fakeGithub(
    [fixture.command, fixture.plan, fixture.stateComment, equivalent], { labels: ['Codex:処理中'] });
  await flow.run({ github, context: context(payload(equivalent)), core });
  assert.equal(github.calls.createComment.length, 0);
  assert.equal(github.calls.updateComment.length, 0);
  assert.equal(flow.authoritativeStateMarker(fixture.stateComment.body).revision, 1);
  assert.deepEqual(github.calls.addLabels.map((call) => call.labels), [['Codex:承認待ち']]);
});

test('question and error result reruns repair their state labels without rewriting authoritative state', async () => {
  for (const [type, expectedLabel] of [['question', 'Codex:回答待ち'], ['error', 'Codex:要判断']]) {
    const command = ownerCommand();
    const result = { id: 110, created_at: '2026-08-22T00:01:00Z',
      body: `人間向け${type}\n\n<!-- codex-semantic-result:v1 type=${type} -->`, user: { ...flow.CODEX_BOT } };
    const issue = { number: 24, title: 'Issue #24相当', body: '要件本文', labels: [] };
    const state = { version: 1, state: type, revision: 0, handledOwnerCommentId: 100,
      sourceOwnerCommentId: 100, sourceSha256: flow.sourceHash({ repository: flow.PARENT_REPOSITORY,
        issue, comments: [command, result], repositoryOwner: OWNER, sourceOwnerCommentId: 100 }),
      planSha256: null, planCommentId: null, resultCommentId: 110,
      approvalCommentId: null, dispatchCommentId: null };
    const stateComment = { id: 115, created_at: '2026-08-22T00:01:30Z',
      body: flow.stateBody(state), user: { ...flow.ACTIONS_BOT } };
    const github = fakeGithub([command, result, stateComment], { labels: ['Codex:処理中'] });
    await flow.run({ github, context: context(payload(result)), core });
    assert.equal(github.calls.createComment.length, 0);
    assert.equal(github.calls.updateComment.length, 0);
    assert.deepEqual(github.calls.addLabels.map((call) => call.labels), [[expectedLabel]]);
  }
});

test('Case 7: owner revise creates a new candidate revision while Actions owns revision and hashes', async () => {
  const first = authoritativePlanFixture();
  const revise = ownerCommand({ id: 120, created_at: '2026-08-22T00:02:00Z', body: '@codex repositoryを変更してください' });
  const revisedPlan = { id: 130, created_at: '2026-08-22T00:03:00Z',
    body: semanticPlan(candidate({ repository: 'shu-matsukubo/matsu-front' }), 'revise'), user: { ...flow.CODEX_BOT } };
  const comments = [first.command, first.plan, first.stateComment, revise, revisedPlan];
  const github = fakeGithub(comments, { labels: ['Codex:処理中'] });
  await flow.run({ github, context: context(payload(revisedPlan)), core });
  assert.equal(github.calls.updateComment.length, 1);
  const state = flow.authoritativeStateMarker(github.calls.updateComment[0].body);
  assert.equal(state.revision, 2);
  assert.equal(state.sourceOwnerCommentId, 120);
  assert.equal(state.planCommentId, 130);
  assert.equal(state.state, 'awaiting-approval');
});

test('Case 4 and 5: exact owner approval verifies current state and projects the plan without Codex reconstruction', async () => {
  const fixture = authoritativePlanFixture({
    planBody: withConnectorFooter(semanticPlan(), 'task-approval'),
  });
  const approval = { id: 120, created_at: '2026-08-22T00:02:00Z', body: '/codex approve', user: { ...OWNER } };
  const comments = [fixture.command, fixture.plan, fixture.stateComment, approval];
  const github = fakeGithub(comments, { labels: ['Codex:承認待ち'], nextIds: [130] });
  await flow.run({ github, context: context(payload(approval)), core });
  assert.equal(github.calls.createComment.length, 1);
  const dispatch = github.calls.createComment[0];
  const marker = flow.dispatchMarker(dispatch.body);
  assert.equal(marker.approvalCommentId, 120);
  assert.equal(marker.revision, 1);
  assert.equal(marker.planCommentId, 110);
  assert.match(dispatch.body, /<!-- codex-task-dispatch:v1/);
  assert.match(dispatch.body, /shu-matsukubo\/matsu-workspace#24:T1:r1/);
  assert.doesNotMatch(dispatch.body, /@codex/i);
  assert.equal(github.calls.updateComment.length, 2);
  const approvalVerified = flow.authoritativeStateMarker(github.calls.updateComment[0].body);
  assert.equal(approvalVerified.state, 'approval-verified');
  assert.equal(approvalVerified.dispatchCommentId, null);
  const approved = flow.authoritativeStateMarker(github.calls.updateComment.at(-1).body);
  assert.equal(approved.state, 'approved');
  assert.equal(approved.dispatchCommentId, 130);
  assert.equal(approved.handledOwnerCommentId, 120);
  assert.deepEqual(github.calls.createWorkflowDispatch, [{ owner: 'shu-matsukubo', repo: 'matsu-workspace',
    workflow_id: 'child-task-dispatcher.yml', ref: 'main',
    inputs: { issue_number: '24', dispatch_comment_id: '130' } }]);
  assert.deepEqual(github.calls.sequence.slice(-2), ['update-comment', 'workflow-dispatch']);
});

test('approval rerun reuses the same Actions dispatch comment', async () => {
  const fixture = authoritativePlanFixture();
  const approval = { id: 120, created_at: '2026-08-22T00:02:00Z', body: '/codex approve', user: { ...OWNER } };
  const marker = { version: 1, revision: 1, approvalCommentId: 120, sourceOwnerCommentId: 100,
    sourceSha256: fixture.state.sourceSha256, planSha256: fixture.state.planSha256, planCommentId: 110 };
  const task = flow.projectCandidate(candidate(), fixture.state, 24);
  const dispatch = { id: 130, created_at: '2026-08-22T00:03:00Z',
    body: flow.buildDispatchBody([task], marker), user: { ...flow.ACTIONS_BOT } };
  const approvedState = { ...fixture.state, state: 'approved', handledOwnerCommentId: 120,
    approvalCommentId: 120, dispatchCommentId: 130 };
  fixture.stateComment.body = flow.stateBody(approvedState);
  const github = fakeGithub([fixture.command, fixture.plan, fixture.stateComment, approval, dispatch], { labels: ['Codex:処理中'] });
  await flow.run({ github, context: context(payload(approval)), core });
  assert.equal(github.calls.createComment.length, 0);
  assert.equal(github.calls.updateComment.length, 1);
  assert.equal(github.calls.createWorkflowDispatch.length, 1);
});

test('approval rerun resumes after approval verification without creating a second state comment', async () => {
  const fixture = authoritativePlanFixture();
  const approval = { id: 120, created_at: '2026-08-22T00:02:00Z', body: '/codex approve', user: { ...OWNER } };
  const verified = { ...fixture.state, state: 'approval-verified', handledOwnerCommentId: 120,
    approvalCommentId: 120, dispatchCommentId: null };
  fixture.stateComment.body = flow.stateBody(verified);
  const github = fakeGithub([fixture.command, fixture.plan, fixture.stateComment, approval],
    { labels: ['Codex:処理中'], nextIds: [130] });
  await flow.run({ github, context: context(payload(approval)), core });
  assert.equal(github.calls.createComment.length, 1);
  assert.match(github.calls.createComment[0].body, /codex-actions-dispatch:v1/);
  assert.equal(github.calls.updateComment.length, 1);
  assert.equal(flow.authoritativeStateMarker(github.calls.updateComment[0].body).state, 'approved');
  assert.equal(github.calls.createWorkflowDispatch.length, 1);
});

test('late duplicate semantic result cannot overwrite an approved state or increment revision', async () => {
  const fixture = authoritativePlanFixture();
  const approval = { id: 120, created_at: '2026-08-22T00:02:00Z', body: '/codex approve', user: { ...OWNER } };
  const approved = { ...fixture.state, state: 'approved', handledOwnerCommentId: 120,
    approvalCommentId: 120, dispatchCommentId: 130 };
  fixture.stateComment.body = flow.stateBody(approved);
  const dispatch = { id: 130, created_at: '2026-08-22T00:03:00Z', body: 'dispatch', user: { ...flow.ACTIONS_BOT } };
  const duplicate = { ...fixture.plan, id: 140, created_at: '2026-08-22T00:04:00Z' };
  const github = fakeGithub([fixture.command, fixture.plan, fixture.stateComment, approval, dispatch, duplicate],
    { labels: ['Codex:子タスク確認待ち'] });
  await flow.run({ github, context: context(payload(duplicate)), core });
  assert.equal(github.calls.createComment.length, 0);
  assert.equal(github.calls.updateComment.length, 0);
  assert.equal(github.calls.addLabels.length, 0);
  assert.equal(github.calls.removeLabel.length, 0);
});

test('Actions dispatch projection never emits a literal automatic Codex mention', () => {
  const fixture = authoritativePlanFixture();
  const mentioned = candidate({ title: '@codex を自動起動しない', work: ['@codex を文字列として扱う'] });
  const task = flow.projectCandidate(mentioned, fixture.state, 24);
  const marker = { version: 1, revision: 1, approvalCommentId: 120,
    sourceOwnerCommentId: 100, sourceSha256: fixture.state.sourceSha256,
    planSha256: fixture.state.planSha256, planCommentId: 110 };
  const body = flow.buildDispatchBody([task], marker);
  assert.doesNotMatch(body, /@codex/i);
  assert.match(body, /\\u0040codex/);
  const stateBodies = ['awaiting-approval', 'question', 'error', 'approval-verified', 'approved']
    .map((state) => flow.stateBody({ ...fixture.state, state }));
  const question = stateBodies[1];
  const error = stateBodies[2];
  assert.doesNotMatch(stateBodies.join('\n'), /@codex/i);
  for (const bodyWithGuidance of [question, error]) {
    assert.match(bodyWithGuidance, /半角の `@` と `codex` を空白なしで続け/);
  }
});

test('plain repository owner comment between source and approval rejects the approval', async () => {
  const fixture = authoritativePlanFixture();
  const plain = { id: 118, created_at: '2026-08-22T00:01:45Z', body: 'この条件も考慮してください', user: { ...OWNER } };
  const approval = { id: 120, created_at: '2026-08-22T00:02:00Z', body: '/codex approve', user: { ...OWNER } };
  const github = fakeGithub([fixture.command, fixture.plan, fixture.stateComment, plain, approval], { labels: ['Codex:承認待ち'] });
  await flow.run({ github, context: context(payload(approval)), core });
  assert.equal(github.calls.createWorkflowDispatch.length, 0);
  assert.equal(github.calls.createComment.length, 1);
  assert.match(github.calls.createComment[0].body, /要件変更として再計画/);
  assert.doesNotMatch(github.calls.createComment[0].body, /@codex/i);
});

test('plain repository owner comment between source command and semantic result rejects the result', async () => {
  const command = ownerCommand();
  const plain = { id: 105, created_at: '2026-08-22T00:00:30Z', body: '追加条件です', user: { ...OWNER } };
  const result = { id: 110, created_at: '2026-08-22T00:01:00Z', body: semanticPlan(), user: { ...flow.CODEX_BOT } };
  const github = fakeGithub([command, plain, result], { labels: ['Codex:処理中'] });
  await flow.run({ github, context: context(payload(result)), core });
  assert.equal(github.calls.createComment.length, 0);
  assert.equal(github.calls.updateComment.length, 0);
});

test('stale approval after a newer owner command is rejected without creating dispatch', async () => {
  const fixture = authoritativePlanFixture();
  const approval = { id: 120, created_at: '2026-08-22T00:02:00Z', body: '/codex approve', user: { ...OWNER } };
  const newer = ownerCommand({ id: 130, created_at: '2026-08-22T00:03:00Z', body: '@codex 計画を変更してください' });
  const github = fakeGithub([fixture.command, fixture.plan, fixture.stateComment, approval, newer], { labels: ['Codex:承認待ち'] });
  await flow.run({ github, context: context(payload(approval)), core });
  assert.equal(github.calls.createComment.length, 1);
  assert.match(github.calls.createComment[0].body, /承認を受理できません/);
  assert.doesNotMatch(github.calls.createComment[0].body, /codex-task-dispatch/);
});

test('edited plan or Issue source is rejected at approval', async () => {
  for (const mutate of [
    (fixture) => { fixture.plan.body = fixture.plan.body.replace('認証境界', '改変済み境界'); },
    (_fixture, github) => { github.rest.issues.get = async () => ({ data: { number: 24, title: '変更後', body: '要件本文', labels: [] } }); },
  ]) {
    const fixture = authoritativePlanFixture();
    const approval = { id: 120, created_at: '2026-08-22T00:02:00Z', body: '/codex approve', user: { ...OWNER } };
    const comments = [fixture.command, fixture.plan, fixture.stateComment, approval];
    const github = fakeGithub(comments, { labels: ['Codex:承認待ち'] });
    mutate(fixture, github);
    await flow.run({ github, context: context(payload(approval)), core });
    assert.equal(github.calls.createComment.length, 1);
    assert.match(github.calls.createComment[0].body, /承認を受理できません/);
  }
});

test('workflow keeps Issue comments as control input and explicitly dispatches the child workflow', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'codex-issue-flow.yml'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, 'codex-issue-flow.cjs'), 'utf8');
  const triggers = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
  assert.match(workflow, /issue_comment:\s*[\s\S]*created/);
  assert.doesNotMatch(triggers, /\n\s+issues:/);
  assert.match(workflow, /permissions:\s*\n\s+actions: write\s*\n\s+contents: read\s*\n\s+issues: write/);
  assert.match(source, /github\.rest\.actions\.createWorkflowDispatch/);
  assert.match(source, /workflow_id: 'child-task-dispatcher\.yml'/);
  assert.match(workflow, /group: codex-issue-\$\{\{ github\.repository_id \}\}-\$\{\{ github\.event\.issue\.number \|\| github\.run_id \}\}/);
  assert.match(workflow, /queue: max/);
  assert.doesNotMatch(workflow, /cancel-in-progress/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY|codex-action/);
});

test('default branch push maintains labels and removes legacy command labels', async () => {
  const github = fakeGithub();
  await flow.run({ github, context: context({ repository: payload(ownerCommand()).repository }, 'push'), core });
  assert.deepEqual(github.calls.deleteLabel.map((call) => call.name), flow.LEGACY_COMMAND_LABELS);
  assert.equal(flow.LABEL_SPECS.every((spec) => flow.STATE_LABELS.includes(spec.name)), true);
});

test('repository skill and protocol expose semantic candidate and Actions approval contracts', () => {
  const root = path.join(__dirname, '..', '..');
  const skill = fs.readFileSync(path.join(root, '.agents', 'skills', 'handle-github-issue-event', 'SKILL.md'), 'utf8');
  const protocol = fs.readFileSync(path.join(root, '.agents', 'skills', 'handle-github-issue-event', 'references', 'issue-protocol.md'), 'utf8');
  const planSkill = fs.readFileSync(path.join(root, '.agents', 'skills', 'plan-tasks', 'SKILL.md'), 'utf8');
  for (const text of [skill, protocol, planSkill]) {
    assert.match(text, /codex-semantic-result:v1/);
    assert.match(text, /\/codex approve/);
    assert.match(text, /workflow_dispatch/);
  }
  assert.match(protocol, /codex-issue-state:v1/);
  assert.match(protocol, /GitHub Actions/);
  assert.match(protocol, /GITHUB_TOKEN.*Issue comment.*再trigger/);
  assert.match(protocol, /`approved`だけを受理/);
  assert.match(protocol, /1 task block = 1 child Issue/);
  assert.match(protocol, /CROSS_REPO_ISSUE_TOKEN/);
});
