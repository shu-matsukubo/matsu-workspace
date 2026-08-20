'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const dispatcher = require('./child-task-dispatcher.cjs');
const issueFlow = require('./codex-issue-flow.cjs');

const OWNER = Object.freeze({ id: 10, login: 'shu-matsukubo', type: 'User' });
const SOURCE_HASH = 'b'.repeat(64);

function resultMarker({ state, revision = 2, handled, source = 100, planHash }) {
  return `<!-- codex-issue-flow state=${state} revision=${revision} handled-owner-comment-id=${handled} source-owner-comment-id=${source} source-sha256=${SOURCE_HASH} plan-sha256=${planHash} -->`;
}

function taskPayload(overrides = {}) {
  const {
    key = 'T1',
    planSha256 = 'a'.repeat(64),
    approvedPlan: approvedPlanOverride,
    ...taskOverrides
  } = overrides;
  const revision = approvedPlanOverride ? approvedPlanOverride.revision : 2;
  const task = {
    version: 1,
    key,
    title: `${key}の実装`,
    repository: 'shu-matsukubo/matsu-front',
    parentIssue: {
      repository: dispatcher.PARENT_REPOSITORY,
      number: 42,
      url: 'https://github.com/shu-matsukubo/matsu-workspace/issues/42',
    },
    approvedPlan: {
      revision,
      sha256: planSha256,
      sourceSha256: SOURCE_HASH,
      sourceOwnerCommentId: 100,
      ...approvedPlanOverride,
    },
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
    dispatchId: dispatcher.computeDispatchId(dispatcher.PARENT_REPOSITORY, 42, key, revision),
    ...taskOverrides,
  };
  return task;
}

function dispatchBlock(task, json = JSON.stringify(task)) {
  return [
    '<!-- codex-task-dispatch:v1',
    json,
    '-->',
    `## ${task.key}: ${task.title}`,
    '',
    `対象repository: \`${task.repository}\``,
    '<!-- /codex-task-dispatch:v1 -->',
  ].join('\n');
}

function parentFixture(taskOverrides = {}, commentUser = issueFlow.CODEX_BOT) {
  const planText = [
    '## 計画 revision 2',
    '',
    '- T1を実装する',
  ].join('\n');
  const planSha256 = dispatcher.planHash(planText);
  const task = taskPayload({ planSha256, ...taskOverrides });
  const sourceCommand = {
    id: 100,
    created_at: '2026-08-18T00:00:00Z',
    body: '@codex タスク分解してください',
    user: { ...OWNER },
  };
  const planComment = {
    id: 110,
    created_at: '2026-08-18T00:01:00Z',
    body: `${planText}\n\n${resultMarker({ state: 'plan', handled: 100, planHash: planSha256 })}`,
    user: { ...issueFlow.CODEX_BOT },
  };
  const approvalCommand = {
    id: 120,
    created_at: '2026-08-18T00:02:00Z',
    body: '@codex 承認します。子タスクへ配送してください',
    user: { ...OWNER },
  };
  const dispatchComment = {
    id: 130,
    created_at: '2026-08-18T00:03:00Z',
    body: `${dispatchBlock(task)}\n\n${resultMarker({ state: 'tasks-dispatched', handled: 120, planHash: planSha256 })}`,
    user: { ...commentUser },
  };
  const comments = [sourceCommand, planComment, approvalCommand, dispatchComment];
  const payload = {
    action: 'created',
    repository: {
      id: 20,
      full_name: dispatcher.PARENT_REPOSITORY,
      owner: { ...OWNER },
      default_branch: 'main',
    },
    issue: { id: 30, number: 42 },
    comment: dispatchComment,
  };
  return { task, comments, payload, planSha256 };
}

function appendNewerOwnerCommandAndResult(fixture) {
  const ownerCommand = {
    id: 140,
    created_at: '2026-08-18T00:04:00Z',
    body: '@codex 新しい指示を処理してください',
    user: { ...OWNER },
  };
  const result = {
    id: 150,
    created_at: '2026-08-18T00:05:00Z',
    body: resultMarker({
      state: 'error',
      revision: 3,
      handled: 140,
      source: 140,
      planHash: 'c'.repeat(64),
    }),
    user: { ...issueFlow.CODEX_BOT },
  };
  fixture.comments.push(ownerCommand, result);
  return { ownerCommand, result };
}

function parentGithub(comments) {
  return {
    paginate: async () => comments,
    rest: { issues: { listComments: async () => ({ data: comments }) } },
  };
}

function context(payload) {
  return { eventName: 'issue_comment', payload };
}

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

test('trusted Codex bot and valid versioned blocks prepare dispatch tasks', async () => {
  const fixture = parentFixture();
  const prepared = await dispatcher.prepareDispatch({
    github: parentGithub(fixture.comments),
    context: context(fixture.payload),
    core: { info() {} },
  });
  assert.equal(prepared.tasks.length, 1);
  assert.equal(prepared.tasks[0].dispatchId, 'shu-matsukubo/matsu-workspace#42:T1:r2');
  assert.equal(prepared.approvedPlan.planSha256, fixture.planSha256);
});

test('owner and unknown bot comments cannot trigger dispatch', async () => {
  for (const user of [OWNER, { id: 999, login: 'unknown[bot]', type: 'Bot' }]) {
    const fixture = parentFixture({}, user);
    const prepared = await dispatcher.prepareDispatch({
      github: parentGithub(fixture.comments),
      context: context(fixture.payload),
    });
    assert.equal(prepared, null);
  }
});

test('comments outside the parent repository cannot trigger dispatch', async () => {
  const fixture = parentFixture();
  fixture.payload.repository.full_name = 'shu-matsukubo/matsu-front';
  const prepared = await dispatcher.prepareDispatch({
    github: parentGithub(fixture.comments),
    context: context(fixture.payload),
  });
  assert.equal(prepared, null);
});

test('dispatch must identify the latest trusted approved plan', async () => {
  const fixture = parentFixture();
  fixture.payload.comment.body = fixture.payload.comment.body.replaceAll(fixture.planSha256, 'c'.repeat(64));
  fixture.comments[3] = fixture.payload.comment;
  await assert.rejects(
    dispatcher.prepareDispatch({ github: parentGithub(fixture.comments), context: context(fixture.payload) }),
    /最新の信頼できるplan/,
  );
});

test('a plan request cannot be reused as the handled approval command', async () => {
  const fixture = parentFixture();
  fixture.comments.splice(2, 1);
  fixture.payload.comment.body = fixture.payload.comment.body.replace(
    'handled-owner-comment-id=120',
    'handled-owner-comment-id=100',
  );
  fixture.comments[2] = fixture.payload.comment;
  await assert.rejects(
    dispatcher.prepareDispatch({ github: parentGithub(fixture.comments), context: context(fixture.payload) }),
    /plan comment|approval|時系列|承認対象/,
  );
});

test('a selected plan comment must precede the handled approval command', async () => {
  const fixture = parentFixture();
  const laterPlanText = '## 計画 revision 3\n\n- 承認コメント後に生成された計画';
  const laterPlanHash = dispatcher.planHash(laterPlanText);
  const laterPlan = {
    id: 125,
    created_at: '2026-08-18T00:02:30Z',
    body: `${laterPlanText}\n\n${resultMarker({ state: 'plan', revision: 3, handled: 120, planHash: laterPlanHash })}`,
    user: { ...issueFlow.CODEX_BOT },
  };
  const task = taskPayload({
    planSha256: laterPlanHash,
    approvedPlan: {
      revision: 3,
      sha256: laterPlanHash,
      sourceSha256: SOURCE_HASH,
      sourceOwnerCommentId: 100,
    },
  });
  fixture.payload.comment = {
    ...fixture.payload.comment,
    body: `${dispatchBlock(task)}\n\n${resultMarker({ state: 'tasks-dispatched', revision: 3, handled: 120, planHash: laterPlanHash })}`,
  };
  fixture.comments = [fixture.comments[0], fixture.comments[1], fixture.comments[2], laterPlan, fixture.payload.comment];
  await assert.rejects(
    dispatcher.prepareDispatch({ github: parentGithub(fixture.comments), context: context(fixture.payload) }),
    /時系列/,
  );
});

test('comment ID is the strict chronology tie-breaker for equal created_at values', async () => {
  const valid = parentFixture();
  valid.comments[1] = { ...valid.comments[1], id: 119, created_at: valid.comments[2].created_at };
  await dispatcher.prepareDispatch({ github: parentGithub(valid.comments), context: context(valid.payload) });

  const invalid = parentFixture();
  invalid.comments[1] = { ...invalid.comments[1], id: 121, created_at: invalid.comments[2].created_at };
  await assert.rejects(
    dispatcher.prepareDispatch({ github: parentGithub(invalid.comments), context: context(invalid.payload) }),
    /時系列/,
  );
});

test('dispatch comment is consumed as an anchored block-group and terminal result grammar', async () => {
  const fixture = parentFixture();
  const validBody = fixture.payload.comment.body;
  const result = validBody.slice(validBody.lastIndexOf('<!-- codex-issue-flow'));
  const second = taskPayload({
    key: 'T2',
    repository: 'shu-matsukubo/matsu-bff',
    planSha256: fixture.planSha256,
  });
  const invalidBodies = [
    `unexpected text\n${validBody}`,
    `${validBody}\nunexpected text`,
    validBody.replaceAll('codex-task-dispatch:v1', 'codex-task-dispatch:v2'),
    validBody.replace('<!-- /codex-task-dispatch:v1 -->', '<!-- /codex-task-dispatch:vi -->'),
    `${dispatchBlock(fixture.task)}\n\n${result}\n\n${dispatchBlock(second)}\n\n${result}`,
    `${dispatchBlock(fixture.task)}\n\n${dispatchBlock(second).replaceAll('codex-task-dispatch:v1', 'codex-task-dispatch:v2')}\n\n${result}`,
  ];

  for (const body of invalidBodies) {
    const invalid = parentFixture();
    invalid.payload.comment = { ...invalid.payload.comment, body };
    invalid.comments[3] = invalid.payload.comment;
    await assert.rejects(
      dispatcher.prepareDispatch({ github: parentGithub(invalid.comments), context: context(invalid.payload) }),
      /dispatch comment|grammar|block|marker|形式/,
    );
  }
});

test('malformed dispatch marker does not produce a child task', async () => {
  const fixture = parentFixture();
  fixture.payload.comment.body = fixture.payload.comment.body.replace(JSON.stringify(fixture.task), '{broken-json');
  fixture.comments[3] = fixture.payload.comment;
  await assert.rejects(
    dispatcher.prepareDispatch({ github: parentGithub(fixture.comments), context: context(fixture.payload) }),
    /正しいJSON/,
  );
});

test('repository outside the explicit allowlist is rejected', async () => {
  const fixture = parentFixture({ repository: 'shu-matsukubo/not-allowed' });
  await assert.rejects(
    dispatcher.prepareDispatch({ github: parentGithub(fixture.comments), context: context(fixture.payload) }),
    /allowlist外/,
  );
});

test('task schema rejects unknown keys and a forged dispatch-id', async () => {
  for (const overrides of [
    { unknownField: 'not allowed' },
    { dispatchId: 'shu-matsukubo/matsu-workspace#42:T1:r999' },
  ]) {
    const fixture = parentFixture(overrides);
    await assert.rejects(
      dispatcher.prepareDispatch({ github: parentGithub(fixture.comments), context: context(fixture.payload) }),
      /schema|dispatchId/,
    );
  }
});

test('two task blocks in one result comment become two prepared tasks', async () => {
  const fixture = parentFixture();
  const second = taskPayload({
    key: 'T2',
    repository: 'shu-matsukubo/matsu-bff',
    planSha256: fixture.planSha256,
  });
  fixture.payload.comment.body = fixture.payload.comment.body.replace(
    '\n\n<!-- codex-issue-flow',
    `\n\n${dispatchBlock(second)}\n\n<!-- codex-issue-flow`,
  );
  fixture.comments[3] = fixture.payload.comment;
  const prepared = await dispatcher.prepareDispatch({
    github: parentGithub(fixture.comments),
    context: context(fixture.payload),
  });
  assert.deepEqual(prepared.tasks.map((task) => task.key), ['T1', 'T2']);
});

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

function childGithub(initialByRepository = {}) {
  const calls = { create: [] };
  const byRepository = Object.fromEntries(Object.entries(initialByRepository).map(([key, value]) => [key, [...value]]));
  return {
    calls,
    byRepository,
    paginate: async (_method, args) => byRepository[`${args.owner}/${args.repo}`] || [],
    rest: { issues: {
      listForRepo: async () => ({ data: [] }),
      create: async (args) => {
        calls.create.push(args);
        const repository = `${args.owner}/${args.repo}`;
        const issue = {
          number: 100 + calls.create.length,
          html_url: `https://github.com/${repository}/issues/${100 + calls.create.length}`,
          title: args.title,
          body: args.body,
          user: { login: 'shu-matsukubo', type: 'User' },
          author_association: 'OWNER',
        };
        if (!byRepository[repository]) byRepository[repository] = [];
        byRepository[repository].push(issue);
        return { data: issue };
      },
    } },
  };
}

function trackingGithub(comments = [], initialState = 'Codex:処理中') {
  const calls = { create: [], update: [], removeLabel: [], addLabels: [] };
  const labels = new Set([initialState]);
  return {
    calls,
    labels,
    paginate: async () => comments,
    rest: { issues: {
      listComments: async () => ({ data: comments }),
      createComment: async (args) => {
        calls.create.push(args);
        const comment = { id: 3, body: args.body, user: { ...dispatcher.TRUSTED_ACTIONS_BOT } };
        comments.push(comment);
        return { data: comment };
      },
      updateComment: async (args) => {
        calls.update.push(args);
        const comment = comments.find((candidate) => candidate.id === args.comment_id);
        if (comment) comment.body = args.body;
        return { data: { id: args.comment_id } };
      },
      getLabel: async () => ({ data: {} }),
      createLabel: async () => ({ data: {} }),
      get: async () => ({ data: { labels: [...labels].map((name) => ({ name })) } }),
      removeLabel: async (args) => {
        calls.removeLabel.push(args);
        labels.delete(args.name);
        return { data: {} };
      },
      addLabels: async (args) => {
        calls.addLabels.push(args);
        for (const name of args.labels) labels.add(name);
        return { data: {} };
      },
    } },
  };
}

test('same dispatch-id is reused on rerun without creating a duplicate Issue', async () => {
  const task = taskPayload();
  const existing = existingChildIssue(task);
  const github = childGithub({ [task.repository]: [existing] });
  const result = await dispatcher.dispatchPrepared({ github, prepared: preparedWithTasks([task]) });
  assert.equal(github.calls.create.length, 0);
  assert.equal(result.items[0].outcome, 'reused');
  assert.equal(result.items[0].issueNumber, 9);
});

test('two prepared task blocks create two child Issues', async () => {
  const first = taskPayload();
  const second = taskPayload({ key: 'T2', repository: 'shu-matsukubo/matsu-bff' });
  const github = childGithub();
  const result = await dispatcher.dispatchPrepared({ github, prepared: preparedWithTasks([first, second]) });
  assert.equal(github.calls.create.length, 2);
  assert.deepEqual(result.items.map((item) => item.taskKey), ['T1', 'T2']);
});

test('partial rerun reuses the successful task and creates only the missing task', async () => {
  const first = taskPayload();
  const second = taskPayload({ key: 'T2', repository: 'shu-matsukubo/matsu-bff' });
  const existing = existingChildIssue(first);
  const github = childGithub({ [first.repository]: [existing] });
  const result = await dispatcher.dispatchPrepared({ github, prepared: preparedWithTasks([first, second]) });
  assert.equal(github.calls.create.length, 1);
  assert.equal(github.calls.create[0].repo, 'matsu-bff');
  assert.deepEqual(result.items.map((item) => item.outcome), ['reused', 'created']);
});

test('a pull request with an exact packet is never reused as a child Issue', async () => {
  const task = taskPayload();
  const pullRequest = existingChildIssue(task, {
    pull_request: { url: 'https://api.github.com/repos/shu-matsukubo/matsu-front/pulls/9' },
  });
  const github = childGithub({ [task.repository]: [pullRequest] });
  const result = await dispatcher.dispatchPrepared({ github, prepared: preparedWithTasks([task]) });
  assert.equal(github.calls.create.length, 1);
  assert.equal(result.items[0].outcome, 'created');
});

test('an owner-created Issue is reused after checkbox, body, and title edits', async () => {
  const task = taskPayload();
  const marker = dispatcher.childIssueMarker(task.dispatchId);
  const edited = existingChildIssue(task, {
    title: '[edited] implementation in progress',
    body: `${marker}\n\n- [x] first completion item\n\nowner note: implementation started`,
  });
  const github = childGithub({ [task.repository]: [edited] });
  const result = await dispatcher.dispatchPrepared({ github, prepared: preparedWithTasks([task]) });
  assert.equal(github.calls.create.length, 0);
  assert.equal(result.items[0].outcome, 'reused');
  assert.equal(result.items[0].issueNumber, 9);
});

test('a non-owner cannot reserve a dispatch-id with an exact execution packet', async () => {
  const task = taskPayload();
  const forged = existingChildIssue(task, {
    user: { login: 'attacker', type: 'User' },
    author_association: 'NONE',
  });
  const github = childGithub({ [task.repository]: [forged] });
  const result = await dispatcher.dispatchPrepared({ github, prepared: preparedWithTasks([task]) });
  assert.equal(github.calls.create.length, 1);
  assert.equal(result.items[0].outcome, 'created');
});

test('an owner Issue with a misplaced, duplicated, or inexact marker is not reused', async () => {
  const task = taskPayload();
  const marker = dispatcher.childIssueMarker(task.dispatchId);
  const invalidCandidates = [
    existingChildIssue(task, { body: `prefix\n${marker}` }),
    existingChildIssue(task, { body: `${marker}\n${marker}` }),
    existingChildIssue(task, { body: `${marker} forged suffix` }),
  ];

  for (const candidate of invalidCandidates) {
    const github = childGithub({ [task.repository]: [candidate] });
    const result = await dispatcher.dispatchPrepared({ github, prepared: preparedWithTasks([task]) });
    assert.equal(github.calls.create.length, 1);
    assert.equal(result.items[0].outcome, 'created');
  }
});

test('execution packet preserves dependencies and never auto-mentions Codex', () => {
  const task = taskPayload({
    dependencies: [{
      target: 'shu-matsukubo/matsu-api#20',
      type: 'hard',
      gate: 'start',
      completion: '関連Pull Requestがmerged',
      evidence: 'open at planning time',
    }],
    work: ['通知文に @codex を直接書かない'],
  });
  const body = dispatcher.buildChildIssueBody(task);
  assert.match(body, /shu-matsukubo\/matsu-api#20/);
  assert.match(body, /実装開始直前に依存対象の現在状態をGitHubから再取得/);
  assert.doesNotMatch(body, /@codex/i);
  assert.match(body, /Codex Web UI/);
  assert.match(body, /実行コンテキスト: `issue-cloud`/);
  assert.match(body, /公開モード: `codex-web-ui`/);
  assert.match(body, /task本文から再判定しません/);
  assert.match(body, /documentation follow-up required/);
});

test('explicitly approved documentation mode permits only the scoped document update', () => {
  const task = taskPayload({
    work: ['承認されたAGENTS.mdの契約を更新する'],
    documentation: {
      mode: 'explicit-update',
      followUp: ['対象: AGENTS.md / 理由: 承認済みAI作業契約の変更'],
    },
  });
  dispatcher.validatePreparedDispatch(preparedWithTasks([task]));
  const body = dispatcher.buildChildIssueBody(task);
  assert.match(body, /mode: `explicit-update`/);
  assert.match(body, /documentation本文の更新が承認範囲に明示的に含まれています/);
  assert.doesNotMatch(body, /利用者・開発者向け文書を変更しません/);
});

test('documentation mode is a strict enum', async () => {
  const fixture = parentFixture({ documentation: { mode: 'implicit-update', followUp: [] } });
  await assert.rejects(
    dispatcher.prepareDispatch({ github: parentGithub(fixture.comments), context: context(fixture.payload) }),
    /documentation\.mode/,
  );
});

test('new child Issue title and body do not contain an automatic Codex mention', async () => {
  const task = taskPayload({ title: '通知 @codex を追加しない', work: ['@codex を自動追加しない'] });
  const github = childGithub();
  await dispatcher.dispatchPrepared({ github, prepared: preparedWithTasks([task]) });
  assert.equal(github.calls.create.length, 1);
  assert.doesNotMatch(github.calls.create[0].title, /@codex/i);
  assert.doesNotMatch(github.calls.create[0].body, /@codex/i);
});

test('missing token fails safely and the token value is never logged', () => {
  assert.throws(() => dispatcher.requireCrossRepoToken(''), /not configured/);
  const secret = 'sensitive-test-token-value-that-must-not-leak';
  assert.equal(dispatcher.requireCrossRepoToken(secret), true);
  assert.doesNotMatch(dispatcher.requireCrossRepoToken.toString(), new RegExp(secret));
});

test('missing token produces one parent-trackable failure for every prepared task', () => {
  const first = taskPayload();
  const second = taskPayload({ key: 'T2', repository: 'shu-matsukubo/matsu-bff' });
  const result = dispatcher.missingTokenDispatchResult(preparedWithTasks([first, second]));
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.failures.map((failure) => failure.taskKey), ['T1', 'T2']);
  assert.ok(result.failures.every((failure) => failure.error.includes('CROSS_REPO_ISSUE_TOKEN')));
});

test('tracking comment is updated idempotently only when authored by GitHub Actions', async () => {
  const fixture = parentFixture();
  const task = fixture.task;
  const prepared = preparedWithTasks([task]);
  const result = {
    version: 1,
    items: [{
      taskKey: 'T1', repository: task.repository, issueNumber: 9,
      url: 'https://github.com/shu-matsukubo/matsu-front/issues/9', outcome: 'reused',
    }],
    failures: [],
  };
  const marker = dispatcher.trackingMarker(prepared);
  const comments = [...fixture.comments,
    { id: 1, body: marker, user: { ...OWNER } },
    { id: 2, body: marker, user: { ...dispatcher.TRUSTED_ACTIONS_BOT } },
  ];
  const github = trackingGithub(comments);
  const tracked = await dispatcher.upsertTrackingComment({
    github,
    prepared,
    result,
    context: context(fixture.payload),
  });
  assert.deepEqual(tracked, { outcome: 'updated', commentId: 2 });
  assert.equal(github.calls.create.length, 0);
  assert.equal(github.calls.update.length, 1);
  assert.match(github.calls.update[0].body, /\[#9\]/);
  assert.ok(github.labels.has('Codex:子タスク確認待ち'));
  assert.ok(!github.labels.has('Codex:処理中'));
});

test('missing token failures are tracked on the parent and move it to judgment required', async () => {
  const fixture = parentFixture();
  const first = fixture.task;
  const second = taskPayload({
    key: 'T2',
    repository: 'shu-matsukubo/matsu-bff',
    planSha256: fixture.planSha256,
  });
  const prepared = preparedWithTasks([first, second]);
  const result = dispatcher.missingTokenDispatchResult(prepared);
  const github = trackingGithub(fixture.comments);
  const tracked = await dispatcher.upsertTrackingComment({
    github,
    prepared,
    result,
    context: context(fixture.payload),
  });
  assert.deepEqual(tracked, { outcome: 'created', commentId: 3 });
  assert.equal(github.calls.create.length, 1);
  assert.match(github.calls.create[0].body, /T1/);
  assert.match(github.calls.create[0].body, /T2/);
  assert.ok(github.labels.has('Codex:要判断'));
  assert.ok(!github.labels.has('Codex:処理中'));
});

test('an old successful dispatch rerun keeps the state chosen by a newer owner command and result', async () => {
  const fixture = parentFixture();
  appendNewerOwnerCommandAndResult(fixture);
  const prepared = preparedWithTasks([fixture.task]);
  const result = {
    version: 1,
    items: [{
      taskKey: fixture.task.key,
      repository: fixture.task.repository,
      issueNumber: 9,
      url: 'https://github.com/shu-matsukubo/matsu-front/issues/9',
      outcome: 'reused',
    }],
    failures: [],
  };
  const infos = [];
  const github = trackingGithub(fixture.comments, 'Codex:PR作成済');
  const tracked = await dispatcher.upsertTrackingComment({
    github,
    prepared,
    result,
    context: context(fixture.payload),
    core: { info(message) { infos.push(message); } },
  });
  assert.equal(tracked.outcome, 'created');
  assert.equal(github.calls.create.length, 1);
  assert.ok(github.labels.has('Codex:PR作成済'));
  assert.deepEqual(github.calls.removeLabel, []);
  assert.deepEqual(github.calls.addLabels, []);
  assert.ok(infos.some((message) => message.includes('state labelは変更しません')));
});

test('malformed and allowlist-rejected dispatches get generic idempotent parent failure tracking', async () => {
  const malformed = parentFixture();
  malformed.payload.comment.body = malformed.payload.comment.body.replace(
    JSON.stringify(malformed.task),
    '{broken-json-sensitive-detail',
  );
  malformed.comments[3] = malformed.payload.comment;
  const disallowed = parentFixture({ repository: 'shu-matsukubo/not-allowed' });
  const untrustedSource = parentFixture();
  untrustedSource.payload.comment.body = untrustedSource.payload.comment.body.replace(
    'source-owner-comment-id=100',
    'source-owner-comment-id=999',
  );
  untrustedSource.comments[3] = untrustedSource.payload.comment;

  for (const fixture of [malformed, disallowed, untrustedSource]) {
    await assert.rejects(
      dispatcher.prepareDispatch({ github: parentGithub(fixture.comments), context: context(fixture.payload) }),
    );
    const github = trackingGithub(fixture.comments);
    const first = await dispatcher.upsertPreparationFailure({
      github,
      context: context(fixture.payload),
    });
    const second = await dispatcher.upsertPreparationFailure({
      github,
      context: context(fixture.payload),
    });
    assert.deepEqual(first, { outcome: 'created', commentId: 3 });
    assert.deepEqual(second, { outcome: 'updated', commentId: 3 });
    assert.equal(github.calls.create.length, 1);
    assert.equal(github.calls.update.length, 1);
    assert.doesNotMatch(github.calls.create[0].body, /broken-json-sensitive-detail|not-allowed/);
    assert.match(github.calls.create[0].body, /検証エラーの詳細や認証情報はこのコメントへ記録していません/);
    assert.ok(github.labels.has('Codex:要判断'));
  }
});

test('generic preparation failure tracking ignores untrusted comments', async () => {
  const fixture = parentFixture({}, { id: 999, login: 'unknown[bot]', type: 'Bot' });
  const github = trackingGithub();
  const tracked = await dispatcher.upsertPreparationFailure({
    github,
    context: context(fixture.payload),
  });
  assert.equal(tracked, null);
  assert.equal(github.calls.create.length, 0);
  assert.ok(github.labels.has('Codex:処理中'));
});

test('an old invalid prepare rerun keeps the state chosen by a newer owner command and result', async () => {
  const fixture = parentFixture();
  fixture.payload.comment.body = fixture.payload.comment.body.replace(
    'state=tasks-dispatched',
    'state=tasks-dispatche',
  );
  fixture.comments[3] = fixture.payload.comment;
  await assert.rejects(
    dispatcher.prepareDispatch({ github: parentGithub(fixture.comments), context: context(fixture.payload) }),
  );
  appendNewerOwnerCommandAndResult(fixture);
  const infos = [];
  const github = trackingGithub(fixture.comments, 'Codex:PR作成済');
  const tracked = await dispatcher.upsertPreparationFailure({
    github,
    context: context(fixture.payload),
    core: { info(message) { infos.push(message); } },
  });
  assert.equal(tracked.outcome, 'created');
  assert.equal(github.calls.create.length, 1);
  assert.ok(github.labels.has('Codex:PR作成済'));
  assert.deepEqual(github.calls.removeLabel, []);
  assert.deepEqual(github.calls.addLabels, []);
  assert.ok(infos.some((message) => message.includes('state labelは変更しません')));
});

test('dispatcher workflow separates parent validation, cross-repository write, and parent tracking tokens', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'child-task-dispatcher.yml'), 'utf8');
  assert.match(workflow, /issue_comment:\s*[\s\S]*created/);
  assert.match(workflow, /github\.repository == 'shu-matsukubo\/matsu-workspace'/);
  assert.match(workflow, /CROSS_REPO_ISSUE_TOKEN/);
  assert.match(workflow, /github-token: \$\{\{ secrets\.CROSS_REPO_ISSUE_TOKEN \}\}/);
  assert.match(workflow, /github-token: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /configured=false/);
  assert.match(workflow, /missingTokenDispatchResult/);
  assert.match(workflow, /steps\.dispatch\.outputs\.dispatch-result \|\| steps\.missing-token\.outputs\.dispatch-result/);
  assert.match(workflow, /core\.setOutput\('prepare-failed', 'true'\)/);
  assert.match(workflow, /core\.setFailed\('Child task dispatch validation failed\.'\)/);
  assert.match(workflow, /always\(\)[\s\S]*steps\.prepare\.outputs\.prepare-failed == 'true'/);
  assert.match(workflow, /upsertPreparationFailure/);
  assert.match(workflow, /upsertTrackingComment\(\{ github, prepared, result, context, core \}\)/);
  assert.doesNotMatch(workflow, /catch \(error\)/);
  assert.match(workflow, /persist-credentials: false/);
});

test('allowlist contains only the eight current child repositories', () => {
  assert.deepEqual(dispatcher.ALLOWED_REPOSITORIES, [
    'shu-matsukubo/matsu-front',
    'shu-matsukubo/matsu-bff',
    'shu-matsukubo/matsu-api',
    'shu-matsukubo/matsu-auth',
    'shu-matsukubo/matsu-toolbox-api',
    'shu-matsukubo/matsu-arcade-auth',
    'shu-matsukubo/matsu-arcade-api',
    'shu-matsukubo/matsu-docs',
  ]);
});
