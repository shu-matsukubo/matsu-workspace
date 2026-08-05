'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const flow = require('./codex-issue-flow.cjs');

function payload(overrides = {}) {
  const owner = { id: 10, login: 'owner', type: 'User' };
  return {
    action: 'labeled',
    repository: { id: 20, owner, default_branch: 'main' },
    sender: owner,
    issue: {
      id: 30,
      number: 1,
      created_at: '2026-08-06T00:00:00Z',
      updated_at: '2026-08-06T00:01:00Z',
      labels: [],
    },
    label: { name: 'Codex:承認' },
    ...overrides,
  };
}

test('command mapping is centralized and only command labels dispatch', () => {
  const p = payload();
  assert.equal(flow.eventCommand(p, 'issues', 'labeled').key, 'approved');
  p.label.name = 'Codex:承認待ち';
  assert.equal(flow.eventCommand(p, 'issues', 'labeled'), null);
  assert.equal(flow.eventCommand(payload({ action: 'opened' }), 'issues', 'opened').key, 'opened');
});

test('repository owner comparison uses stable id and login', () => {
  assert.equal(flow.isRepositoryOwner(payload()), true);
  assert.equal(flow.isRepositoryOwner(payload({ sender: { id: 999, login: 'owner' } })), false);
  assert.equal(flow.isRepositoryOwner(payload({ sender: { id: 10, login: 'spoof' } })), false);
});

test('dispatch key is stable for reruns and changes after label re-addition', () => {
  const p = payload();
  const command = flow.eventCommand(p, 'issues', 'labeled');
  const first = flow.dispatchKey(p, 'issues', 'labeled', command);
  assert.equal(first, flow.dispatchKey(p, 'issues', 'labeled', command));
  p.issue.updated_at = '2026-08-06T00:02:00Z';
  assert.notEqual(first, flow.dispatchKey(p, 'issues', 'labeled', command));
});

test('dispatch body contains no Issue body and identifies the skill and envelope', () => {
  const body = flow.buildDispatchBody({ command: flow.COMMANDS['Codex:承認'], key: 'a'.repeat(64), issueNumber: 8 });
  assert.match(body, /^@codex/m);
  assert.match(body, /handle-github-issue-event\/SKILL\.md/);
  assert.match(body, /封筒であり要件の正本ではありません/);
  assert.doesNotMatch(body, /\$\{\{/);
});

test('only exact Codex bot identity and strict result marker are trusted', () => {
  const trusted = { user: { ...flow.CODEX_BOT } };
  assert.equal(flow.isTrustedCodexComment(trusted), true);
  assert.equal(flow.isTrustedCodexComment({ user: { ...flow.CODEX_BOT, id: 1 } }), false);
  const marker = `<!-- codex-issue-flow state=plan revision=2 handled-dispatch-key=${'b'.repeat(64)} source-sha256=${'c'.repeat(64)} plan-sha256=${'d'.repeat(64)} -->`;
  assert.deepEqual(flow.resultMarker(marker), {
    state: 'plan', revision: 2, handledDispatchKey: 'b'.repeat(64), sourceSha256: 'c'.repeat(64), planSha256: 'd'.repeat(64),
  });
  assert.equal(flow.resultMarker('<!-- codex-issue-flow state=plan revision=x -->'), null);
});

test('only exact Actions bot dispatch marker is trusted', () => {
  const body = flow.dispatchMarker('a'.repeat(64), 'approved');
  const trusted = { id: 1, created_at: '2026-08-06T00:00:00Z', body, user: { ...flow.ACTIONS_BOT } };
  assert.deepEqual(flow.parseDispatchMarker(body), { key: 'a'.repeat(64), event: 'approved' });
  assert.equal(flow.isTrustedActionsComment(trusted), true);
  assert.equal(flow.isTrustedActionsComment({ ...trusted, user: { ...flow.ACTIONS_BOT, id: 1 } }), false);
  assert.equal(flow.latestTrustedDispatch([
    { ...trusted, id: 2, user: { id: 10, login: 'owner', type: 'User' } },
    trusted,
  ]).comment.id, 1);
});

function fakeGithub(comments = [], currentLabels = []) {
  const calls = { addLabels: [], removeLabel: [], createComment: [] };
  const labels = new Set(currentLabels);
  return {
    calls,
    paginate: async () => comments,
    rest: { issues: {
      listComments: async () => ({ data: comments }),
      get: async () => ({ data: { labels: [...labels].map((name) => ({ name })) } }),
      addLabels: async (args) => { calls.addLabels.push(args); for (const name of args.labels) labels.add(name); },
      removeLabel: async (args) => { calls.removeLabel.push(args); labels.delete(args.name); },
      createComment: async (args) => calls.createComment.push(args),
      getLabel: async () => ({}),
      createLabel: async () => ({}),
    } },
  };
}

const core = { info() {}, warning() {} };

test('approval while processing is not dispatched and command label is consumed', async () => {
  const p = payload();
  p.issue.labels = [{ name: 'Codex:処理中' }, { name: 'Codex:承認' }];
  const github = fakeGithub([], ['Codex:処理中', 'Codex:承認']);
  await flow.run({ github, core, context: { eventName: 'issues', payload: p, repo: { owner: 'owner', repo: 'repo' } } });
  assert.equal(github.calls.createComment.length, 0);
  assert.deepEqual(github.calls.removeLabel.map((call) => call.name), ['Codex:承認']);
});

test('rerun reconciles labels after a trusted dispatch comment', async () => {
  const p = payload();
  const command = flow.eventCommand(p, 'issues', 'labeled');
  const key = flow.dispatchKey(p, 'issues', 'labeled', command);
  const comments = [{
    id: 1,
    created_at: '2026-08-06T00:01:01Z',
    body: flow.dispatchMarker(key, command.key),
    user: { ...flow.ACTIONS_BOT },
  }];
  const github = fakeGithub(comments, ['Codex:承認']);
  await flow.run({ github, core, context: { eventName: 'issues', payload: p, repo: { owner: 'owner', repo: 'repo' } } });
  assert.equal(github.calls.createComment.length, 0);
  assert.deepEqual(github.calls.addLabels.map((call) => call.labels), [['Codex:処理中']]);
  assert.deepEqual(github.calls.removeLabel.map((call) => call.name), ['Codex:承認']);
});

test('rerun of a superseded dispatch cannot overwrite newer state', async () => {
  const p = payload();
  const command = flow.eventCommand(p, 'issues', 'labeled');
  const oldKey = flow.dispatchKey(p, 'issues', 'labeled', command);
  const comments = [
    { id: 1, created_at: '2026-08-06T00:01:01Z', body: flow.dispatchMarker(oldKey, command.key), user: { ...flow.ACTIONS_BOT } },
    { id: 2, created_at: '2026-08-06T00:02:01Z', body: flow.dispatchMarker('f'.repeat(64), 'revise'), user: { ...flow.ACTIONS_BOT } },
  ];
  const github = fakeGithub(comments);
  await flow.run({ github, core, context: { eventName: 'issues', payload: p, repo: { owner: 'owner', repo: 'repo' } } });
  assert.equal(github.calls.createComment.length, 0);
  assert.equal(github.calls.addLabels.length, 0);
  assert.equal(github.calls.removeLabel.length, 0);
});

test('old Codex result cannot overwrite state after a newer dispatch', async () => {
  const oldKey = 'a'.repeat(64);
  const newKey = 'b'.repeat(64);
  const oldResultBody = `<!-- codex-issue-flow state=plan revision=1 handled-dispatch-key=${oldKey} -->`;
  const comments = [
    { id: 1, created_at: '2026-08-06T00:00:00Z', body: flow.dispatchMarker(oldKey, 'opened'), user: { ...flow.ACTIONS_BOT } },
    { id: 2, created_at: '2026-08-06T00:01:00Z', body: flow.dispatchMarker(newKey, 'revise'), user: { ...flow.ACTIONS_BOT } },
  ];
  const comment = { id: 3, created_at: '2026-08-06T00:02:00Z', body: oldResultBody, user: { ...flow.CODEX_BOT } };
  const github = fakeGithub(comments);
  await flow.run({ github, core, context: {
    eventName: 'issue_comment',
    payload: { action: 'created', repository: payload().repository, issue: payload().issue, comment },
    repo: { owner: 'owner', repo: 'repo' },
  } });
  assert.equal(github.calls.addLabels.length, 0);
  assert.equal(github.calls.removeLabel.length, 0);
});

test('older result for the current dispatch key cannot overwrite its latest result', async () => {
  const key = 'c'.repeat(64);
  const dispatch = { id: 1, created_at: '2026-08-06T00:00:00Z', body: flow.dispatchMarker(key, 'opened'), user: { ...flow.ACTIONS_BOT } };
  const oldComment = { id: 2, created_at: '2026-08-06T00:01:00Z', body: `<!-- codex-issue-flow state=question revision=1 handled-dispatch-key=${key} -->`, user: { ...flow.CODEX_BOT } };
  const latestComment = { id: 3, created_at: '2026-08-06T00:02:00Z', body: `<!-- codex-issue-flow state=plan revision=2 handled-dispatch-key=${key} -->`, user: { ...flow.CODEX_BOT } };
  const github = fakeGithub([dispatch, oldComment, latestComment]);
  await flow.run({ github, core, context: {
    eventName: 'issue_comment',
    payload: { action: 'created', repository: payload().repository, issue: payload().issue, comment: oldComment },
    repo: { owner: 'owner', repo: 'repo' },
  } });
  assert.equal(github.calls.addLabels.length, 0);
  assert.equal(github.calls.removeLabel.length, 0);
});

test('incomplete plan marker cannot advance state', async () => {
  const key = 'd'.repeat(64);
  const dispatch = { id: 1, created_at: '2026-08-06T00:00:00Z', body: flow.dispatchMarker(key, 'opened'), user: { ...flow.ACTIONS_BOT } };
  const comment = { id: 2, created_at: '2026-08-06T00:01:00Z', body: `<!-- codex-issue-flow state=plan revision=1 handled-dispatch-key=${key} -->`, user: { ...flow.CODEX_BOT } };
  const github = fakeGithub([dispatch, comment], ['Codex:処理中']);
  await flow.run({ github, core, context: {
    eventName: 'issue_comment',
    payload: { action: 'created', repository: payload().repository, issue: payload().issue, comment },
    repo: { owner: 'owner', repo: 'repo' },
  } });
  assert.equal(github.calls.addLabels.length, 0);
  assert.equal(github.calls.removeLabel.length, 0);
});

test('valid latest result replaces every current state label with one state', async () => {
  const key = 'e'.repeat(64);
  const hash = 'f'.repeat(64);
  const dispatch = { id: 1, created_at: '2026-08-06T00:00:00Z', body: flow.dispatchMarker(key, 'opened'), user: { ...flow.ACTIONS_BOT } };
  const comment = { id: 2, created_at: '2026-08-06T00:01:00Z', body: `<!-- codex-issue-flow state=plan revision=1 handled-dispatch-key=${key} source-sha256=${hash} plan-sha256=${hash} -->`, user: { ...flow.CODEX_BOT } };
  const github = fakeGithub([dispatch, comment], ['Codex:処理中', 'Codex:回答待ち']);
  await flow.run({ github, core, context: {
    eventName: 'issue_comment',
    payload: { action: 'created', repository: payload().repository, issue: payload().issue, comment },
    repo: { owner: 'owner', repo: 'repo' },
  } });
  assert.deepEqual(github.calls.removeLabel.map((call) => call.name).sort(), ['Codex:処理中', 'Codex:回答待ち'].sort());
  assert.deepEqual(github.calls.addLabels.map((call) => call.labels), [['Codex:承認待ち']]);
});

test('workflow keeps minimum permissions, default branch checkout, and queued issue concurrency', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'codex-issue-flow.yml'), 'utf8');
  assert.match(workflow, /issues:\s*[\s\S]*opened[\s\S]*labeled/);
  assert.match(workflow, /issue_comment:\s*[\s\S]*created/);
  assert.match(workflow, /permissions:\s*\n\s+contents: read\s*\n\s+issues: write/);
  assert.match(workflow, /group: codex-issue-\$\{\{ github\.repository_id \}\}-\$\{\{ github\.event\.issue\.number \}\}/);
  assert.match(workflow, /queue: max/);
  assert.doesNotMatch(workflow, /cancel-in-progress/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /persist-credentials: false/);
});

test('repository skill metadata is complete and references its protocol', () => {
  const skillRoot = path.join(__dirname, '..', '..', '.agents', 'skills', 'handle-github-issue-event');
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const metadata = fs.readFileSync(path.join(skillRoot, 'agents', 'openai.yaml'), 'utf8');
  assert.match(skill, /^---\s*\nname: handle-github-issue-event\s*\ndescription: .+\n---/);
  assert.match(skill, /references\/issue-protocol\.md/);
  assert.doesNotMatch(skill, /TODO/);
  assert.match(metadata, /default_prompt: ".*\$handle-github-issue-event/);
});

test('comment chronology uses ordinal ordering without localeCompare', () => {
  assert.equal(flow.compareOrdinal('2026-08-06T00:00:00Z', '2026-08-06T00:00:01Z'), -1);
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = () => { throw new Error('localeCompare must not be used'); };
  try {
    const first = { id: 1, created_at: '2026-08-06T00:00:00Z', body: flow.dispatchMarker('1'.repeat(64), 'opened'), user: { ...flow.ACTIONS_BOT } };
    const second = { id: 2, created_at: '2026-08-06T00:00:01Z', body: flow.dispatchMarker('2'.repeat(64), 'revise'), user: { ...flow.ACTIONS_BOT } };
    assert.equal(flow.latestTrustedDispatch([second, first]).comment.id, 2);
  } finally {
    String.prototype.localeCompare = original;
  }
});
