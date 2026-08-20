'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const flow = require('./codex-issue-flow.cjs');

const OWNER = Object.freeze({ id: 10, login: 'owner', type: 'User' });
const HASH = 'a'.repeat(64);

function payload(commentOverrides = {}, payloadOverrides = {}) {
  const comment = {
    id: 100,
    created_at: '2026-08-06T00:01:00Z',
    body: '@codex タスク分解お願いします',
    user: { ...OWNER },
    ...commentOverrides,
  };
  return {
    action: 'created',
    repository: { id: 20, owner: { ...OWNER }, default_branch: 'main' },
    sender: comment.user,
    issue: { id: 30, number: 1, labels: [] },
    comment,
    ...payloadOverrides,
  };
}

function marker({ state = 'plan', revision = 1, handled = 100, source = 100, sourceHash = HASH, planHash = HASH } = {}) {
  const fields = [
    `state=${state}`,
    `revision=${revision}`,
    `handled-owner-comment-id=${handled}`,
  ];
  if (source !== null) fields.push(`source-owner-comment-id=${source}`);
  if (sourceHash !== null) fields.push(`source-sha256=${sourceHash}`);
  if (planHash !== null) fields.push(`plan-sha256=${planHash}`);
  return `<!-- codex-issue-flow ${fields.join(' ')} -->`;
}

function fakeGithub(comments = [], currentLabels = []) {
  const calls = {
    addLabels: [], createLabel: [], deleteLabel: [], removeLabel: [],
  };
  const labels = new Set(currentLabels);
  return {
    calls,
    paginate: async () => comments,
    rest: { issues: {
      listComments: async () => ({ data: comments }),
      get: async () => ({ data: { labels: [...labels].map((name) => ({ name })) } }),
      addLabels: async (args) => { calls.addLabels.push(args); for (const name of args.labels) labels.add(name); },
      removeLabel: async (args) => { calls.removeLabel.push(args); labels.delete(args.name); },
      getLabel: async () => ({}),
      createLabel: async (args) => calls.createLabel.push(args),
      deleteLabel: async (args) => calls.deleteLabel.push(args),
    } },
  };
}

const core = { info() {}, warning() {} };

function context(eventPayload, eventName = 'issue_comment') {
  return { eventName, payload: eventPayload, repo: { owner: 'owner', repo: 'repo' } };
}

test('Codex mention matching accepts natural-language placement but not lookalikes', () => {
  assert.equal(flow.containsCodexMention('@codex タスク分解お願いします'), true);
  assert.equal(flow.containsCodexMention('確認です。(@Codex) 進めてください'), true);
  assert.equal(flow.containsCodexMention('@codex-agent 実装お願いします'), false);
  assert.equal(flow.containsCodexMention('codex 実装お願いします'), false);
});

test('only a repository owner comment containing @codex is a trusted command', () => {
  const p = payload();
  assert.equal(flow.isTrustedOwnerCommand(p.comment, p.repository.owner), true);
  assert.equal(flow.isTrustedOwnerCommand({ ...p.comment, user: { ...OWNER, id: 999 } }, p.repository.owner), false);
  assert.equal(flow.isTrustedOwnerCommand({ ...p.comment, body: '実装お願いします' }, p.repository.owner), false);
  assert.equal(flow.isTrustedOwnerCommand({ ...p.comment, user: { ...flow.CODEX_BOT } }, p.repository.owner), false);
});

test('strict result marker links the result to owner and source comment IDs', () => {
  assert.deepEqual(flow.resultMarker(marker({ revision: 2, handled: 120, source: 100 })), {
    state: 'plan', revision: 2, handledOwnerCommentId: 120, sourceOwnerCommentId: 100,
    sourceSha256: HASH, planSha256: HASH,
  });
  assert.equal(flow.isValidResultMarker(flow.resultMarker(marker({ handled: 120, source: 100 }))), true);
  assert.equal(flow.resultMarker(`<!-- codex-issue-flow state=plan revision=2 handled-dispatch-key=${HASH} source-sha256=${HASH} plan-sha256=${HASH} -->`), null);
  assert.equal(flow.resultMarker('<!-- codex-issue-flow state=plan revision=x -->'), null);
});

test('question may omit plan hash and error may omit source data', () => {
  assert.equal(flow.isValidResultMarker(flow.resultMarker(marker({ state: 'question', planHash: null }))), true);
  assert.equal(flow.isValidResultMarker(flow.resultMarker(marker({ state: 'error', revision: 0, source: null, sourceHash: null, planHash: null }))), true);
  assert.equal(flow.isValidResultMarker(flow.resultMarker(marker({ state: 'error', revision: 0, source: 0, sourceHash: null, planHash: null }))), false);
  assert.equal(flow.isValidResultMarker(flow.resultMarker(marker({ state: 'question', revision: 0, planHash: null }))), false);
  assert.equal(flow.isValidResultMarker(flow.resultMarker(marker({ state: 'plan', revision: 0 }))), false);
  assert.equal(flow.isValidResultMarker(flow.resultMarker(marker({ state: 'plan', planHash: null }))), false);
});

test('tasks-dispatched is a strict result state with an approved plan identity', () => {
  const parsed = flow.resultMarker(marker({ state: 'tasks-dispatched', revision: 2 }));
  assert.equal(flow.isValidResultMarker(parsed), true);
  assert.equal(flow.STATE_FROM_RESULT['tasks-dispatched'], 'Codex:処理中');
  assert.equal(flow.isValidResultMarker(flow.resultMarker(marker({
    state: 'tasks-dispatched', revision: 2, planHash: null,
  }))), false);
});

test('owner @codex comment changes state to processing without creating a bot mention', async () => {
  const p = payload();
  const github = fakeGithub([p.comment], ['Codex:承認待ち']);
  await flow.run({ github, core, context: context(p) });
  assert.deepEqual(github.calls.removeLabel.map((call) => call.name), ['Codex:承認待ち']);
  assert.deepEqual(github.calls.addLabels.map((call) => call.labels), [['Codex:処理中']]);
  assert.equal('createComment' in github.calls, false);
});

test('owner comment without @codex and non-owner mention do not change state', async () => {
  for (const p of [
    payload({ body: 'タスク分解お願いします' }),
    payload({ user: { id: 11, login: 'other', type: 'User' } }),
  ]) {
    const github = fakeGithub([p.comment], ['Codex:承認待ち']);
    await flow.run({ github, core, context: context(p) });
    assert.equal(github.calls.addLabels.length, 0);
    assert.equal(github.calls.removeLabel.length, 0);
  }
});

test('Pull Request comments are not treated as the Issue control plane', async () => {
  const p = payload({}, { issue: { id: 30, number: 1, labels: [], pull_request: { url: 'https://example.test/pr/1' } } });
  const github = fakeGithub([p.comment]);
  await flow.run({ github, core, context: context(p) });
  assert.equal(github.calls.addLabels.length, 0);
});

test('rerun of the same owner comment reconciles an existing result instead of processing', async () => {
  const p = payload();
  const result = {
    id: 101, created_at: '2026-08-06T00:02:00Z', body: marker(), user: { ...flow.CODEX_BOT },
  };
  const github = fakeGithub([p.comment, result], ['Codex:処理中']);
  await flow.run({ github, core, context: context(p) });
  assert.deepEqual(github.calls.removeLabel.map((call) => call.name), ['Codex:処理中']);
  assert.deepEqual(github.calls.addLabels.map((call) => call.labels), [['Codex:承認待ち']]);
});

test('rerun for an older owner command cannot overwrite a newer command state', async () => {
  const p = payload();
  const newer = { ...p.comment, id: 110, created_at: '2026-08-06T00:02:00Z', body: '@codex 実装お願いします' };
  const github = fakeGithub([p.comment, newer], ['Codex:処理中']);
  await flow.run({ github, core, context: context(p) });
  assert.equal(github.calls.addLabels.length, 0);
  assert.equal(github.calls.removeLabel.length, 0);
});

test('old Codex result cannot overwrite state after a newer owner command', async () => {
  const p = payload();
  const newer = { ...p.comment, id: 110, created_at: '2026-08-06T00:02:00Z', body: '@codex 実装お願いします' };
  const result = { id: 120, created_at: '2026-08-06T00:03:00Z', body: marker(), user: { ...flow.CODEX_BOT } };
  const resultPayload = payload(result, { sender: result.user });
  const github = fakeGithub([p.comment, newer, result], ['Codex:処理中']);
  await flow.run({ github, core, context: context(resultPayload) });
  assert.equal(github.calls.addLabels.length, 0);
  assert.equal(github.calls.removeLabel.length, 0);
});

test('result must refer to a trusted owner @codex comment', async () => {
  const untrusted = { id: 100, created_at: '2026-08-06T00:01:00Z', body: '@codex 実装お願いします', user: { id: 11, login: 'other', type: 'User' } };
  const result = { id: 101, created_at: '2026-08-06T00:02:00Z', body: marker(), user: { ...flow.CODEX_BOT } };
  const p = payload(result, { sender: result.user });
  const github = fakeGithub([untrusted, result], ['Codex:処理中']);
  await flow.run({ github, core, context: context(p) });
  assert.equal(github.calls.addLabels.length, 0);
  assert.equal(github.calls.removeLabel.length, 0);
});

test('result source boundary must refer to a repository owner comment', async () => {
  const ownerCommand = payload().comment;
  const untrustedSource = { id: 99, created_at: '2026-08-06T00:00:00Z', body: '要件', user: { id: 11, login: 'other', type: 'User' } };
  const result = { id: 101, created_at: '2026-08-06T00:02:00Z', body: marker({ source: 99 }), user: { ...flow.CODEX_BOT } };
  const p = payload(result, { sender: result.user });
  const github = fakeGithub([untrustedSource, ownerCommand, result], ['Codex:処理中']);
  await flow.run({ github, core, context: context(p) });
  assert.equal(github.calls.addLabels.length, 0);
  assert.equal(github.calls.removeLabel.length, 0);
});

test('owner command rerun does not reconcile a result with an untrusted source boundary', async () => {
  const p = payload();
  const untrustedSource = { id: 99, created_at: '2026-08-06T00:00:00Z', body: '要件', user: { id: 11, login: 'other', type: 'User' } };
  const result = { id: 101, created_at: '2026-08-06T00:02:00Z', body: marker({ source: 99 }), user: { ...flow.CODEX_BOT } };
  const github = fakeGithub([untrustedSource, p.comment, result], ['Codex:処理中']);
  await flow.run({ github, core, context: context(p) });
  assert.equal(github.calls.addLabels.length, 0);
  assert.equal(github.calls.removeLabel.length, 0);
});

test('owner command rerun does not reconcile a result whose source boundary follows the handled comment', async () => {
  const p = payload();
  const futureSource = { ...p.comment, id: 120, body: '後から追加された要件' };
  const result = { id: 130, created_at: '2026-08-06T00:02:00Z', body: marker({ handled: 100, source: 120 }), user: { ...flow.CODEX_BOT } };
  const github = fakeGithub([p.comment, futureSource, result], ['Codex:処理中']);
  await flow.run({ github, core, context: context(p) });
  assert.equal(github.calls.addLabels.length, 0);
  assert.equal(github.calls.removeLabel.length, 0);
});

test('result event rejects a source boundary after the handled comment, including error results', async () => {
  const ownerCommand = payload().comment;
  const futureSource = { ...ownerCommand, id: 120, body: '後から追加された要件' };
  for (const resultBody of [
    marker({ handled: 100, source: 120 }),
    marker({ state: 'error', handled: 100, source: 120, sourceHash: null, planHash: null }),
  ]) {
    const result = { id: 130, created_at: '2026-08-06T00:02:00Z', body: resultBody, user: { ...flow.CODEX_BOT } };
    const p = payload(result, { sender: result.user });
    const github = fakeGithub([ownerCommand, futureSource, result], ['Codex:処理中']);
    await flow.run({ github, core, context: context(p) });
    assert.equal(github.calls.addLabels.length, 0);
    assert.equal(github.calls.removeLabel.length, 0);
  }
});

test('error result without a source boundary remains valid and synchronizes state', async () => {
  const ownerCommand = payload().comment;
  const result = {
    id: 101,
    created_at: '2026-08-06T00:02:00Z',
    body: marker({ state: 'error', revision: 0, source: null, sourceHash: null, planHash: null }),
    user: { ...flow.CODEX_BOT },
  };
  const p = payload(result, { sender: result.user });
  const github = fakeGithub([ownerCommand, result], ['Codex:処理中']);
  await flow.run({ github, core, context: context(p) });
  assert.deepEqual(github.calls.removeLabel.map((call) => call.name), ['Codex:処理中']);
  assert.deepEqual(github.calls.addLabels.map((call) => call.labels), [['Codex:要判断']]);
});

test('older result for the current owner comment cannot overwrite its latest result', async () => {
  const ownerCommand = payload().comment;
  const oldResult = { id: 101, created_at: '2026-08-06T00:02:00Z', body: marker({ state: 'question', planHash: null }), user: { ...flow.CODEX_BOT } };
  const latestResult = { id: 102, created_at: '2026-08-06T00:03:00Z', body: marker({ state: 'plan', revision: 2 }), user: { ...flow.CODEX_BOT } };
  const p = payload(oldResult, { sender: oldResult.user });
  const github = fakeGithub([ownerCommand, oldResult, latestResult], ['Codex:処理中']);
  await flow.run({ github, core, context: context(p) });
  assert.equal(github.calls.addLabels.length, 0);
  assert.equal(github.calls.removeLabel.length, 0);
});

test('valid latest result replaces every current state label with one state', async () => {
  const ownerCommand = payload().comment;
  const result = { id: 101, created_at: '2026-08-06T00:02:00Z', body: marker(), user: { ...flow.CODEX_BOT } };
  const p = payload(result, { sender: result.user });
  const github = fakeGithub([ownerCommand, result], ['Codex:処理中', 'Codex:回答待ち']);
  await flow.run({ github, core, context: context(p) });
  assert.deepEqual(github.calls.removeLabel.map((call) => call.name).sort(), ['Codex:処理中', 'Codex:回答待ち'].sort());
  assert.deepEqual(github.calls.addLabels.map((call) => call.labels), [['Codex:承認待ち']]);
});

test('tasks-dispatched result defers final state to Child Task Dispatcher', async () => {
  const ownerCommand = payload().comment;
  const result = {
    id: 101,
    created_at: '2026-08-06T00:02:00Z',
    body: marker({ state: 'tasks-dispatched', revision: 2 }),
    user: { ...flow.CODEX_BOT },
  };
  const p = payload(result, { sender: result.user });
  const github = fakeGithub([ownerCommand, result], ['Codex:処理中']);
  await flow.run({ github, core, context: context(p) });
  assert.deepEqual(github.calls.removeLabel, []);
  assert.deepEqual(github.calls.addLabels, []);
});

test('default branch push removes legacy command labels and preserves status definitions', async () => {
  const github = fakeGithub();
  await flow.run({ github, core, context: context({ repository: payload().repository }, 'push') });
  assert.deepEqual(github.calls.deleteLabel.map((call) => call.name), flow.LEGACY_COMMAND_LABELS);
  assert.equal(flow.LABEL_SPECS.every((spec) => flow.STATE_LABELS.includes(spec.name)), true);
});

test('workflow listens only for Issue comments plus main migration push', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'codex-issue-flow.yml'), 'utf8');
  const triggers = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
  assert.match(workflow, /issue_comment:\s*[\s\S]*created/);
  assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- main/);
  assert.doesNotMatch(triggers, /\n\s+issues:/);
  assert.match(workflow, /permissions:\s*\n\s+contents: read\s*\n\s+issues: write/);
  assert.match(workflow, /group: codex-issue-\$\{\{ github\.repository_id \}\}-\$\{\{ github\.event\.issue\.number \|\| github\.run_id \}\}/);
  assert.match(workflow, /queue: max/);
  assert.doesNotMatch(workflow, /cancel-in-progress/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /persist-credentials: false/);
});

test('repository skill metadata is complete and references its protocol on any newline style', () => {
  const skillRoot = path.join(__dirname, '..', '..', '.agents', 'skills', 'handle-github-issue-event');
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8').replace(/\r\n?/g, '\n');
  const metadata = fs.readFileSync(path.join(skillRoot, 'agents', 'openai.yaml'), 'utf8');
  assert.match(skill, /^---\s*\nname: handle-github-issue-event\s*\ndescription: .+\n---/);
  assert.match(skill, /references\/issue-protocol\.md/);
  assert.match(skill, /`plan`[\s\S]*`answer`[\s\S]*`revise`[\s\S]*`dispatch`[\s\S]*`review-fix`[\s\S]*`unknown`/);
  assert.match(skill, /承認指示に要件変更が含まれれば`revise`/);
  assert.doesNotMatch(skill, /TODO/);
  assert.match(metadata, /default_prompt: ".*\$handle-github-issue-event/);
});

test('protocol defines safe result states and task template preserves the source boundary', () => {
  const repositoryRoot = path.join(__dirname, '..', '..');
  const protocol = fs.readFileSync(path.join(
    repositoryRoot, '.agents', 'skills', 'handle-github-issue-event', 'references', 'issue-protocol.md',
  ), 'utf8').replace(/\r\n?/g, '\n');
  const taskTemplate = fs.readFileSync(path.join(repositoryRoot, '.agents', 'tasks', 'TEMPLATE.md'), 'utf8')
    .replace(/\r\n?/g, '\n');
  const skill = fs.readFileSync(path.join(
    repositoryRoot, '.agents', 'skills', 'handle-github-issue-event', 'SKILL.md',
  ), 'utf8').replace(/\r\n?/g, '\n');
  assert.match(protocol, /`error`だけは`revision=0`を許可/);
  assert.match(protocol, /ユーザー確認を返す結果は`state=question`/);
  assert.match(protocol, /修正と再検証が成功[\s\S]*`state=pr-created`/);
  assert.match(protocol, /handled commentより後の境界を持つresultは同期しない/);
  assert.match(protocol, /`state=tasks-dispatched`/);
  assert.match(protocol, /1 task block = 1 child Issue/);
  assert.match(protocol, /plan comment < handled owner approval comment < dispatch comment/);
  assert.match(protocol, /block外の文字列、未認識version、marker typo/);
  assert.match(protocol, /Pull Requestは除外/);
  assert.match(protocol, /全taskを失敗として親tracking commentへupsert/);
  assert.match(protocol, /user\.login=shu-matsukubo/);
  assert.match(protocol, /generic failure commentを冪等にupsert/);
  assert.match(protocol, /`follow-up-only`または`explicit-update`/);
  assert.match(protocol, /人数と担当範囲はpayloadへ追加せず/);
  assert.match(protocol, /必要最小限を決め/);
  assert.match(protocol, /state label同期の直前に全コメントを再取得/);
  assert.match(skill, /明示承認した場合だけ`explicit-update`/);
  assert.match(taskTemplate, /承認時source境界owner comment ID:/);
  assert.match(taskTemplate, /タスクキー:/);
  assert.match(taskTemplate, /agent strategy:/);
  assert.match(taskTemplate, /人数や担当範囲を固定しない/);
  assert.match(taskTemplate, /agent allocation・実行結果:/);
  assert.match(taskTemplate, /documentation mode:/);
  assert.match(taskTemplate, /`concerns`、`documentation mode`を同じ承認内容のprojection/);
  assert.match(taskTemplate, /## 懸念事項/);
});

test('comment chronology uses ordinal ordering without localeCompare', () => {
  assert.equal(flow.compareOrdinal('2026-08-06T00:00:00Z', '2026-08-06T00:00:01Z'), -1);
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = () => { throw new Error('localeCompare must not be used'); };
  try {
    const first = { ...payload().comment, created_at: '2026-08-06T00:00:00Z' };
    const second = { ...first, id: 101, created_at: '2026-08-06T00:00:01Z' };
    assert.equal(flow.latestTrustedOwnerCommand([second, first], OWNER).id, 101);
  } finally {
    String.prototype.localeCompare = original;
  }
});
