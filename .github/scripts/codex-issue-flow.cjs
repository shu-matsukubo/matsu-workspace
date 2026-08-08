'use strict';

const CODEX_BOT = Object.freeze({
  login: 'chatgpt-codex-connector[bot]',
  id: 199175422,
  type: 'Bot',
});

const LEGACY_COMMAND_LABELS = Object.freeze([
  'Codex:回答済',
  'Codex:差し戻し',
  'Codex:承認',
]);

const STATE_LABELS = Object.freeze([
  'Codex:処理中',
  'Codex:回答待ち',
  'Codex:承認待ち',
  'Codex:依存待ち',
  'Codex:要判断',
  'Codex:PR作成済',
]);

const LABEL_SPECS = Object.freeze([
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

function isIssueCommentOnPullRequest(payload) {
  return Boolean(payload.issue && payload.issue.pull_request);
}

function containsCodexMention(body) {
  return /(?:^|[^A-Za-z0-9_-])@codex(?![A-Za-z0-9_-])/i.test(body || '');
}

function isRepositoryOwnerComment(comment, repositoryOwner) {
  const author = comment && comment.user;
  return Boolean(
    author
      && repositoryOwner
      && author.id === repositoryOwner.id
      && author.login === repositoryOwner.login,
  );
}

function isTrustedOwnerCommand(comment, repositoryOwner) {
  return isRepositoryOwnerComment(comment, repositoryOwner) && containsCodexMention(comment.body);
}

function resultMarker(body) {
  const pattern = /<!-- codex-issue-flow state=(processing|question|plan|dependency-wait|dependency-cycle|blocked|error|pr-created) revision=(\d+) handled-owner-comment-id=(\d+)(?: source-owner-comment-id=(\d+))?(?: source-sha256=([a-f0-9]{64}))?(?: plan-sha256=([a-f0-9]{64}))? -->/g;
  let match;
  let last = null;
  while ((match = pattern.exec(body || '')) !== null) {
    last = {
      state: match[1],
      revision: Number(match[2]),
      handledOwnerCommentId: Number(match[3]),
      sourceOwnerCommentId: match[4] ? Number(match[4]) : null,
      sourceSha256: match[5] || null,
      planSha256: match[6] || null,
    };
  }
  return last;
}

function isValidResultMarker(marker) {
  if (!marker || !Number.isSafeInteger(marker.revision) || marker.revision < 0) return false;
  if (marker.state !== 'error' && marker.revision < 1) return false;
  if (!Number.isSafeInteger(marker.handledOwnerCommentId) || marker.handledOwnerCommentId < 1) return false;
  if (marker.state === 'error') {
    return marker.sourceOwnerCommentId === null
      || (Number.isSafeInteger(marker.sourceOwnerCommentId) && marker.sourceOwnerCommentId > 0);
  }
  if (!Number.isSafeInteger(marker.sourceOwnerCommentId) || marker.sourceOwnerCommentId < 1) return false;
  if (!marker.sourceSha256) return false;
  if (marker.state === 'question') return true;
  return Boolean(marker.planSha256);
}

function isTrustedCodexComment(comment) {
  const user = comment && comment.user;
  return Boolean(user && user.login === CODEX_BOT.login && user.id === CODEX_BOT.id && user.type === CODEX_BOT.type);
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

function latestTrustedOwnerCommand(comments, repositoryOwner) {
  return comments
    .filter((comment) => isTrustedOwnerCommand(comment, repositoryOwner))
    .sort(byCreatedAtAndId)
    .at(-1) || null;
}

function hasTrustedSourceBoundary(marker, comments, repositoryOwner) {
  const handledComment = comments.find((comment) => comment.id === marker.handledOwnerCommentId);
  if (!isTrustedOwnerCommand(handledComment, repositoryOwner)) return false;
  if (marker.sourceOwnerCommentId === null) return marker.state === 'error';
  const sourceComment = comments.find((comment) => comment.id === marker.sourceOwnerCommentId);
  return isRepositoryOwnerComment(sourceComment, repositoryOwner)
    && byCreatedAtAndId(sourceComment, handledComment) <= 0;
}

function latestTrustedResult(comments, ownerCommentId, repositoryOwner) {
  const candidates = comments
    .filter(isTrustedCodexComment)
    .map((comment) => ({ comment, marker: resultMarker(comment.body) }))
    .filter((item) => isValidResultMarker(item.marker)
      && item.marker.handledOwnerCommentId === ownerCommentId
      && hasTrustedSourceBoundary(item.marker, comments, repositoryOwner))
    .sort((left, right) => byCreatedAtAndId(left.comment, right.comment));
  return candidates.at(-1) || null;
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

async function deleteLegacyCommandLabels(github, owner, repo) {
  for (const name of LEGACY_COMMAND_LABELS) {
    try {
      await github.rest.issues.deleteLabel({ owner, repo, name });
    } catch (error) {
      if (error.status !== 404) throw error;
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

function commentsIncludingPayload(listed, payloadComment) {
  return listed.some((comment) => comment.id === payloadComment.id)
    ? listed
    : [...listed, payloadComment];
}

async function handleOwnerCommand({ github, context, core }) {
  const { payload } = context;
  if (isIssueCommentOnPullRequest(payload)) return core.info('Pull Requestコメントはcontrol planeではないため対象外です。');
  if (!isTrustedOwnerCommand(payload.comment, payload.repository && payload.repository.owner)) {
    return core.info('repository ownerの@codex付きコメントではないため起動状態を変更しません。');
  }

  const { owner, repo } = context.repo;
  const issueNumber = payload.issue.number;
  await ensureLabels(github, owner, repo);
  const listed = await listAllComments(github, owner, repo, issueNumber);
  const comments = commentsIncludingPayload(listed, payload.comment);
  const latestCommand = latestTrustedOwnerCommand(comments, payload.repository.owner);
  if (!latestCommand || latestCommand.id !== payload.comment.id) {
    return core.info('より新しいowner @codexコメントがあるため古いrunをreconcileしません。');
  }

  const result = latestTrustedResult(comments, payload.comment.id, payload.repository.owner);
  const state = result ? STATE_FROM_RESULT[result.marker.state] : 'Codex:処理中';
  await replaceStateLabel(github, owner, repo, issueNumber, state);
}

async function handleStateSync({ github, context, core }) {
  const { payload } = context;
  if (isIssueCommentOnPullRequest(payload)) return core.info('Pull Requestコメントはcontrol planeではないため対象外です。');
  if (!isTrustedCodexComment(payload.comment)) return core.info('信頼するCodex bot以外のmarkerは無視します。');
  const marker = resultMarker(payload.comment.body);
  if (!marker) return core.info('有効なCodex result markerがありません。');
  if (!isValidResultMarker(marker)) return core.warning('必須ID、hashまたはrevisionがない不完全なresult markerを無視します。');

  const { owner, repo } = context.repo;
  const issueNumber = payload.issue.number;
  const listed = await listAllComments(github, owner, repo, issueNumber);
  const comments = commentsIncludingPayload(listed, payload.comment);
  const ownerComment = comments.find((comment) => comment.id === marker.handledOwnerCommentId);
  if (!isTrustedOwnerCommand(ownerComment, payload.repository && payload.repository.owner)) {
    return core.warning('信頼できるowner @codexコメントに対応しない結果のため状態を変更しません。');
  }
  if (!hasTrustedSourceBoundary(marker, comments, payload.repository && payload.repository.owner)) {
    return core.warning('handled comment以前の信頼できるowner source境界に対応しない結果のため状態を変更しません。');
  }

  const latestCommand = latestTrustedOwnerCommand(comments, payload.repository.owner);
  if (!latestCommand || latestCommand.id !== marker.handledOwnerCommentId) {
    return core.warning('最新のowner @codexコメントに対応しない結果のため状態を変更しません。');
  }
  const latestResult = latestTrustedResult(comments, marker.handledOwnerCommentId, payload.repository.owner);
  if (!latestResult || latestResult.comment.id !== payload.comment.id) {
    return core.info('同じowner comment IDの最新Codex resultではないため状態を変更しません。');
  }

  await ensureLabels(github, owner, repo);
  await replaceStateLabel(github, owner, repo, issueNumber, STATE_FROM_RESULT[marker.state]);
}

async function handleLabelMigration({ github, context, core }) {
  const { owner, repo } = context.repo;
  await ensureLabels(github, owner, repo);
  await deleteLegacyCommandLabels(github, owner, repo);
  core.info('status labelを確認し、旧コマンドラベルを削除しました。');
}

async function run({ github, context, core }) {
  if (context.eventName === 'push') return handleLabelMigration({ github, context, core });
  if (context.eventName !== 'issue_comment' || context.payload.action !== 'created') {
    return core.info('対象イベントではないため終了します。');
  }
  if (isTrustedCodexComment(context.payload.comment)) {
    return handleStateSync({ github, context, core });
  }
  return handleOwnerCommand({ github, context, core });
}

module.exports = {
  CODEX_BOT,
  LABEL_SPECS,
  LEGACY_COMMAND_LABELS,
  STATE_FROM_RESULT,
  STATE_LABELS,
  compareOrdinal,
  containsCodexMention,
  isRepositoryOwnerComment,
  isTrustedCodexComment,
  isTrustedOwnerCommand,
  isValidResultMarker,
  latestTrustedOwnerCommand,
  latestTrustedResult,
  resultMarker,
  run,
};
