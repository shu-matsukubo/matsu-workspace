'use strict';

const crypto = require('node:crypto');

const CODEX_BOT = Object.freeze({
  login: 'chatgpt-codex-connector[bot]',
  id: 199175422,
  type: 'Bot',
});

const ACTIONS_BOT = Object.freeze({
  login: 'github-actions[bot]',
  id: 41898282,
  type: 'Bot',
});

const COMMANDS = Object.freeze({
  opened: Object.freeze({
    key: 'opened',
    prompt: 'Issueが登録されました。Issue全体を確認し、情報不足なら質問し、十分なら計画を提示してください。実装は開始せず承認を待ってください。',
  }),
  'Codex:回答済': Object.freeze({
    key: 'answered',
    prompt: '最新の質問以降のユーザー回答とIssue全体を再評価してください。確定できれば計画し、不足があれば未解決の質問だけを提示してください。実装は開始せず承認を待ってください。',
  }),
  'Codex:差し戻し': Object.freeze({
    key: 'revise',
    prompt: '最新の計画以降のユーザーコメントを確認し、影響部分だけを修正して新しいrevisionの計画を提示してください。実装は開始せず再承認を待ってください。',
  }),
  'Codex:承認': Object.freeze({
    key: 'approved',
    prompt: '承認された最新計画を特定し、前提・CI・依存関係の現在状態と循環を再確認してから、承認範囲だけの実装フローを開始してください。安全に確定できない場合は実装しないでください。',
  }),
});

const COMMAND_LABELS = Object.freeze(Object.keys(COMMANDS).filter((key) => key !== 'opened'));
const STATE_LABELS = Object.freeze([
  'Codex:処理中',
  'Codex:回答待ち',
  'Codex:承認待ち',
  'Codex:依存待ち',
  'Codex:要判断',
  'Codex:PR作成済',
]);

const LABEL_SPECS = Object.freeze([
  ['Codex:回答済', '0e8a16', 'ユーザー操作: 質問への回答をCodexへ通知する'],
  ['Codex:差し戻し', 'd93f0b', 'ユーザー操作: 最新計画の修正をCodexへ依頼する'],
  ['Codex:承認', '1d76db', 'ユーザー操作: 最新計画の実装を承認する'],
  ['Codex:処理中', '5319e7', 'Actions管理: Codexの処理開始から結果コメントまで'],
  ['Codex:回答待ち', 'fbca04', 'Actions管理: ユーザー回答待ち'],
  ['Codex:承認待ち', 'c2e0c6', 'Actions管理: 最新計画の承認待ち'],
  ['Codex:依存待ち', 'f9d0c4', 'Actions管理: hard dependencyの完了待ち'],
  ['Codex:要判断', 'b60205', 'Actions管理: 循環・前提変更・安全性の判断待ち'],
  ['Codex:PR作成済', '0e8a16', 'Actions管理: draft Pull Request作成済み'],
].map(([name, color, description]) => Object.freeze({ name, color, description })));

const STATE_FROM_RESULT = Object.freeze({
  processing: 'Codex:処理中',
  question: 'Codex:回答待ち',
  plan: 'Codex:承認待ち',
  'dependency-wait': 'Codex:依存待ち',
  'dependency-cycle': 'Codex:要判断',
  blocked: 'Codex:要判断',
  error: 'Codex:要判断',
  'pr-created': 'Codex:PR作成済',
});

function isRepositoryOwner(payload) {
  const sender = payload.sender;
  const owner = payload.repository && payload.repository.owner;
  return Boolean(sender && owner && sender.id === owner.id && sender.login === owner.login);
}

function isIssueCommentOnPullRequest(payload) {
  return Boolean(payload.issue && payload.issue.pull_request);
}

function eventCommand(payload, eventName, action) {
  if (eventName === 'issues' && action === 'opened') return COMMANDS.opened;
  if (eventName !== 'issues' || action !== 'labeled') return null;
  const label = payload.label && payload.label.name;
  return label ? COMMANDS[label] || null : null;
}

function dispatchKey(payload, eventName, action, command) {
  const issue = payload.issue;
  const stableEventState = eventName === 'issues' && action === 'opened'
    ? issue.created_at
    : issue.updated_at;
  const raw = [payload.repository.id, issue.id, eventName, action, command.key, stableEventState].join(':');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function dispatchMarker(key, event) {
  return `<!-- codex-issue-flow dispatch-key=${key} event=${event} -->`;
}

function parseDispatchMarker(body) {
  const match = /<!-- codex-issue-flow dispatch-key=([a-f0-9]{64}) event=(opened|answered|revise|approved) -->/.exec(body || '');
  return match ? { key: match[1], event: match[2] } : null;
}

function resultMarker(body) {
  const pattern = /<!-- codex-issue-flow state=(processing|question|plan|dependency-wait|dependency-cycle|blocked|error|pr-created) revision=(\d+) handled-dispatch-key=([a-f0-9]{64})(?: source-sha256=([a-f0-9]{64}))?(?: plan-sha256=([a-f0-9]{64}))? -->/g;
  let match;
  let last = null;
  while ((match = pattern.exec(body || '')) !== null) {
    last = {
      state: match[1],
      revision: Number(match[2]),
      handledDispatchKey: match[3],
      sourceSha256: match[4] || null,
      planSha256: match[5] || null,
    };
  }
  return last;
}

function isValidResultMarker(marker) {
  if (!marker || !Number.isInteger(marker.revision) || marker.revision < 1) return false;
  if (marker.state === 'error') return true;
  if (!marker.sourceSha256) return false;
  if (marker.state === 'question') return true;
  return Boolean(marker.planSha256);
}

function isTrustedCodexComment(comment) {
  const user = comment && comment.user;
  return Boolean(user && user.login === CODEX_BOT.login && user.id === CODEX_BOT.id && user.type === CODEX_BOT.type);
}

function isTrustedActionsComment(comment) {
  const user = comment && comment.user;
  return Boolean(user && user.login === ACTIONS_BOT.login && user.id === ACTIONS_BOT.id && user.type === ACTIONS_BOT.type);
}

function compareOrdinal(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function byCreatedAtAndId(left, right) {
  const time = compareOrdinal(left.created_at || '', right.created_at || '');
  return time || Number(left.id || 0) - Number(right.id || 0);
}

function latestTrustedDispatch(comments) {
  const candidates = comments
    .filter(isTrustedActionsComment)
    .map((comment) => ({ comment, marker: parseDispatchMarker(comment.body) }))
    .filter((item) => item.marker)
    .sort((left, right) => byCreatedAtAndId(left.comment, right.comment));
  return candidates.at(-1) || null;
}

function latestTrustedResult(comments, dispatchKeyValue) {
  const candidates = comments
    .filter(isTrustedCodexComment)
    .map((comment) => ({ comment, marker: resultMarker(comment.body) }))
    .filter((item) => isValidResultMarker(item.marker) && item.marker.handledDispatchKey === dispatchKeyValue)
    .sort((left, right) => byCreatedAtAndId(left.comment, right.comment));
  return candidates.at(-1) || null;
}

function buildDispatchBody({ command, key, issueNumber }) {
  return [
    '@codex',
    dispatchMarker(key, command.key),
    '',
    `GitHub Issue #${issueNumber} のイベント通知です。`,
    command.prompt,
    '',
    'このコメントはイベントの封筒であり要件の正本ではありません。Issue本文、現在のラベル、全コメント、関連Issue・Pull Requestの現在状態を確認してください。',
    '`.agents/skills/handle-github-issue-event/SKILL.md` を使用し、既存skillsへ処理を委譲してください。最終コメントにはprotocol所定のresult markerを1つ付けてください。',
  ].join('\n');
}

async function listAllComments(github, owner, repo, issueNumber) {
  return github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });
}

async function ensureLabels(github, owner, repo) {
  for (const spec of LABEL_SPECS) {
    try {
      await github.rest.issues.getLabel({ owner, repo, name: spec.name });
    } catch (error) {
      if (error.status !== 404) throw error;
      await github.rest.issues.createLabel({ owner, repo, ...spec });
    }
  }
}

async function replaceStateLabel(github, owner, repo, issueNumber, nextState) {
  const response = await github.rest.issues.get({ owner, repo, issue_number: issueNumber });
  const currentLabels = new Set((response.data.labels || []).map((label) => typeof label === 'string' ? label : label.name));
  for (const label of STATE_LABELS) {
    if (label === nextState || !currentLabels.has(label)) continue;
    try {
      await github.rest.issues.removeLabel({ owner, repo, issue_number: issueNumber, name: label });
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  if (!currentLabels.has(nextState)) {
    await github.rest.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: [nextState] });
  }
}

async function consumeCommandLabel(github, owner, repo, issueNumber, commandLabel) {
  if (!commandLabel || !COMMAND_LABELS.includes(commandLabel)) return;
  try {
    await github.rest.issues.removeLabel({ owner, repo, issue_number: issueNumber, name: commandLabel });
  } catch (error) {
    if (error.status !== 404) throw error;
  }
}

async function handleDispatch({ github, context, core }) {
  const { payload, eventName } = context;
  const command = eventCommand(payload, eventName, payload.action);
  if (!command) return core.info('Codex command eventではないため終了します。');
  if (!isRepositoryOwner(payload)) return core.info('repository owner以外の操作は起動対象外です。');

  const { owner, repo } = context.repo;
  const issueNumber = payload.issue.number;
  const commandLabel = payload.label && payload.label.name;
  if (payload.action === 'opened') await ensureLabels(github, owner, repo);
  const currentIssue = await github.rest.issues.get({ owner, repo, issue_number: issueNumber });
  const labels = new Set((currentIssue.data.labels || []).map((label) => typeof label === 'string' ? label : label.name));
  if (labels.has('Codex:処理中')) {
    await consumeCommandLabel(github, owner, repo, issueNumber, commandLabel);
    return core.info('既に処理中のため重複dispatchせず、コマンドラベルだけを消費しました。');
  }

  const key = dispatchKey(payload, eventName, payload.action, command);
  const comments = await listAllComments(github, owner, repo, issueNumber);
  const existing = comments.find((comment) => {
    if (!isTrustedActionsComment(comment)) return false;
    const marker = parseDispatchMarker(comment.body);
    return marker && marker.key === key && marker.event === command.key;
  });
  if (existing) {
    const latestDispatch = latestTrustedDispatch(comments);
    if (!latestDispatch || latestDispatch.marker.key !== key) {
      return core.info(`より新しいdispatchがあるため古いrunをreconcileしません: ${key}`);
    }
    const result = latestTrustedResult(comments, key);
    const state = result ? STATE_FROM_RESULT[result.marker.state] : 'Codex:処理中';
    await replaceStateLabel(github, owner, repo, issueNumber, state);
    await consumeCommandLabel(github, owner, repo, issueNumber, commandLabel);
    return core.info(`dispatch済みイベントの状態をreconcileしました: ${key}`);
  }

  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: buildDispatchBody({ command, key, issueNumber }),
  });
  await replaceStateLabel(github, owner, repo, issueNumber, 'Codex:処理中');

  await consumeCommandLabel(github, owner, repo, issueNumber, commandLabel);
}

async function handleStateSync({ github, context, core }) {
  const { payload } = context;
  if (isIssueCommentOnPullRequest(payload)) return core.info('Pull Requestコメントは対象外です。');
  if (!isTrustedCodexComment(payload.comment)) return core.info('信頼するCodex bot以外のmarkerは無視します。');
  const marker = resultMarker(payload.comment.body);
  if (!marker) return core.info('有効なCodex result markerがありません。');
  if (!isValidResultMarker(marker)) return core.warning('必須hashまたはrevisionがない不完全なresult markerを無視します。');

  const { owner, repo } = context.repo;
  const issueNumber = payload.issue.number;
  const listed = await listAllComments(github, owner, repo, issueNumber);
  const comments = listed.some((comment) => comment.id === payload.comment.id)
    ? listed
    : [...listed, payload.comment];
  const dispatch = latestTrustedDispatch(comments);
  if (!dispatch || dispatch.marker.key !== marker.handledDispatchKey) {
    return core.warning('最新の信頼済みdispatchに対応しない結果のため状態を変更しません。');
  }
  const latestResult = latestTrustedResult(comments, marker.handledDispatchKey);
  if (!latestResult || latestResult.comment.id !== payload.comment.id) {
    return core.info('同じdispatch keyの最新Codex resultではないため状態を変更しません。');
  }

  await replaceStateLabel(
    github,
    owner,
    repo,
    issueNumber,
    STATE_FROM_RESULT[marker.state],
  );
}

async function run({ github, context, core }) {
  if (context.eventName === 'issue_comment' && context.payload.action === 'created') {
    return handleStateSync({ github, context, core });
  }
  return handleDispatch({ github, context, core });
}

module.exports = {
  ACTIONS_BOT,
  CODEX_BOT,
  COMMANDS,
  COMMAND_LABELS,
  STATE_LABELS,
  LABEL_SPECS,
  STATE_FROM_RESULT,
  buildDispatchBody,
  compareOrdinal,
  dispatchKey,
  dispatchMarker,
  eventCommand,
  isTrustedActionsComment,
  isRepositoryOwner,
  isTrustedCodexComment,
  isValidResultMarker,
  latestTrustedDispatch,
  latestTrustedResult,
  parseDispatchMarker,
  resultMarker,
  run,
};
