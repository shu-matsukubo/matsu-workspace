'use strict';

const issueFlow = require('./codex-issue-flow.cjs');
const executionPolicy = require('./task-execution-policy.cjs');

const PARENT_REPOSITORY = issueFlow.PARENT_REPOSITORY;
const TRUSTED_ACTIONS_BOT = issueFlow.ACTIONS_BOT;
const TRUSTED_CHILD_ISSUE_CREATOR = Object.freeze({
  login: 'shu-matsukubo',
  type: 'User',
  authorAssociation: 'OWNER',
});
const ALLOWED_REPOSITORIES = issueFlow.ALLOWED_REPOSITORIES;
const ALLOWED_REPOSITORY_SET = new Set(ALLOWED_REPOSITORIES);
const AGENT_STRATEGIES = new Set([
  'parent-only',
  'worker-parent-review',
  'worker-reviewer-parent',
]);
const PRIORITIES = new Set(['high', 'normal', 'low']);
const VERIFICATION_MODES = new Set(['normal', 'issue-ci-delegated']);
const DOCUMENTATION_MODES = new Set(['follow-up-only', 'explicit-update']);
const DEPENDENCY_TYPES = new Set(['hard', 'soft', 'ordering']);
const DEPENDENCY_GATES = new Set(['start', 'complete', 'publish', 'merge']);
const DISPATCH_OPEN = '<!-- codex-task-dispatch:v1';
const DISPATCH_CLOSE = '<!-- /codex-task-dispatch:v1 -->';
const CHILD_MARKER_PREFIX = '<!-- codex-child-task-dispatch:v1 ';
const TRACKING_MARKER_PREFIX = '<!-- codex-child-task-tracking:v1 ';
const PREPARATION_FAILURE_MARKER_PREFIX = '<!-- codex-child-task-prepare-failure:v1 ';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TASK_KEY_PATTERN = /^[A-Z][A-Z0-9_-]{0,31}$/;
const DISPATCH_ID_PATTERN = /^[A-Za-z0-9_.\/-]+#[1-9]\d*:[A-Z][A-Z0-9_-]{0,31}:r[1-9]\d*$/;

function compareOrdinal(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').normalize('NFC');
}

function countOccurrences(value, needle) {
  return normalizeText(value).split(needle).length - 1;
}

function assertPlainObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path}はobjectである必要があります。`);
  }
}

function assertExactKeys(value, expected, path) {
  assertPlainObject(value, path);
  const actual = Object.keys(value).sort(compareOrdinal);
  const wanted = [...expected].sort(compareOrdinal);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${path}のkeyがschemaと一致しません。`);
  }
}

function assertNonEmptyString(value, path) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${path}は空でない文字列である必要があります。`);
  }
}

function assertStringArray(value, path, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${path}は${allowEmpty ? '' : '空でない'}文字列配列である必要があります。`);
  }
  value.forEach((item, index) => assertNonEmptyString(item, `${path}[${index}]`));
}

function expectedParentIssueUrl(repository, issueNumber) {
  return `https://github.com/${repository}/issues/${issueNumber}`;
}

function computeDispatchId(parentRepository, parentIssueNumber, taskKey, planRevision) {
  return `${parentRepository}#${parentIssueNumber}:${taskKey}:r${planRevision}`;
}

function validateParentIssue(parentIssue, expected) {
  assertExactKeys(parentIssue, ['repository', 'number', 'url'], 'parentIssue');
  if (parentIssue.repository !== expected.repository) throw new Error('parentIssue.repositoryがeventと一致しません。');
  if (!Number.isSafeInteger(parentIssue.number) || parentIssue.number < 1 || parentIssue.number !== expected.number) {
    throw new Error('parentIssue.numberがeventと一致しません。');
  }
  const expectedUrl = expectedParentIssueUrl(expected.repository, expected.number);
  if (parentIssue.url !== expectedUrl) throw new Error('parentIssue.urlが正規URLと一致しません。');
}

function validateApprovedPlan(approvedPlan, expected) {
  assertExactKeys(
    approvedPlan,
    ['revision', 'sha256', 'sourceSha256', 'sourceOwnerCommentId'],
    'approvedPlan',
  );
  if (!Number.isSafeInteger(approvedPlan.revision) || approvedPlan.revision < 1) {
    throw new Error('approvedPlan.revisionは正の整数である必要があります。');
  }
  if (!SHA256_PATTERN.test(approvedPlan.sha256) || !SHA256_PATTERN.test(approvedPlan.sourceSha256)) {
    throw new Error('approvedPlanのhashがSHA-256形式ではありません。');
  }
  if (!Number.isSafeInteger(approvedPlan.sourceOwnerCommentId) || approvedPlan.sourceOwnerCommentId < 1) {
    throw new Error('approvedPlan.sourceOwnerCommentIdは正の整数である必要があります。');
  }
  if (expected && (
    approvedPlan.revision !== expected.revision
    || approvedPlan.sha256 !== expected.planSha256
    || approvedPlan.sourceSha256 !== expected.sourceSha256
    || approvedPlan.sourceOwnerCommentId !== expected.sourceOwnerCommentId
  )) {
    throw new Error('task payloadのapprovedPlanが承認済みplan markerと一致しません。');
  }
}

function validateDependencies(dependencies) {
  if (!Array.isArray(dependencies)) throw new Error('dependenciesは配列である必要があります。');
  dependencies.forEach((dependency, index) => {
    const path = `dependencies[${index}]`;
    assertExactKeys(dependency, ['target', 'type', 'gate', 'completion', 'evidence'], path);
    assertNonEmptyString(dependency.target, `${path}.target`);
    assertNonEmptyString(dependency.completion, `${path}.completion`);
    assertNonEmptyString(dependency.evidence, `${path}.evidence`);
    if (!DEPENDENCY_TYPES.has(dependency.type)) throw new Error(`${path}.typeが未対応です。`);
    if (!DEPENDENCY_GATES.has(dependency.gate)) throw new Error(`${path}.gateが未対応です。`);
    if (dependency.type === 'ordering' && (dependency.gate === 'start' || dependency.gate === 'complete')) {
      throw new Error(`${path}のordering dependencyにstart/complete gateは指定できません。`);
    }
  });
}

function validateTaskPayload(task, expected) {
  const keys = [
    'version', 'key', 'title', 'repository', 'parentIssue', 'approvedPlan', 'priority',
    'agentStrategy', 'work', 'outOfScope', 'completion', 'dependencies', 'concerns',
    'verification', 'cloudPublish', 'documentation', 'dispatchId',
  ];
  assertExactKeys(task, keys, 'task payload');
  if (task.version !== 1) throw new Error('task payload versionは1である必要があります。');
  if (typeof task.key !== 'string' || !TASK_KEY_PATTERN.test(task.key)) throw new Error('task key形式が不正です。');
  assertNonEmptyString(task.title, 'title');
  if (/\r|\n/.test(task.title) || task.title.length > 256) throw new Error('titleは256文字以内の単一行である必要があります。');
  if (!ALLOWED_REPOSITORY_SET.has(task.repository)) throw new Error(`allowlist外repositoryです: ${task.repository}`);
  validateParentIssue(task.parentIssue, expected.parentIssue);
  validateApprovedPlan(task.approvedPlan, expected.approvedPlan);
  if (!PRIORITIES.has(task.priority)) throw new Error('priorityが未対応です。');
  if (!AGENT_STRATEGIES.has(task.agentStrategy)) throw new Error('agentStrategyが未対応です。');
  assertStringArray(task.work, 'work', { allowEmpty: false });
  assertStringArray(task.outOfScope, 'outOfScope');
  assertStringArray(task.completion, 'completion', { allowEmpty: false });
  validateDependencies(task.dependencies);
  assertStringArray(task.concerns, 'concerns');
  assertExactKeys(task.verification, ['mode', 'steps'], 'verification');
  if (!VERIFICATION_MODES.has(task.verification.mode)) throw new Error('verification.modeが未対応です。');
  assertStringArray(task.verification.steps, 'verification.steps', { allowEmpty: false });
  if (task.cloudPublish !== 'commit-and-web-ui-pr') throw new Error('cloudPublishが固定値と一致しません。');
  assertExactKeys(task.documentation, ['mode', 'followUp'], 'documentation');
  if (!DOCUMENTATION_MODES.has(task.documentation.mode)) throw new Error('documentation.modeが未対応です。');
  assertStringArray(task.documentation.followUp, 'documentation.followUp');
  const recomputed = computeDispatchId(
    task.parentIssue.repository,
    task.parentIssue.number,
    task.key,
    task.approvedPlan.revision,
  );
  if (task.dispatchId !== recomputed || !DISPATCH_ID_PATTERN.test(task.dispatchId)) {
    throw new Error(`dispatchIdが再計算値と一致しません: ${task.key}`);
  }
  return task;
}

function parseDispatchCommentEnvelope(body) {
  let normalized = normalizeText(body);
  if (normalized.endsWith('\n')) normalized = normalized.slice(0, -1);
  if (!normalized.startsWith(`${DISPATCH_OPEN}\n`)) {
    throw new Error('dispatch commentはversion 1 task blockから開始する必要があります。');
  }

  const rawBlocks = [];
  let cursor = 0;
  while (normalized.startsWith(`${DISPATCH_OPEN}\n`, cursor)) {
    const jsonStart = cursor + DISPATCH_OPEN.length + 1;
    const machineEnd = normalized.indexOf('\n-->\n', jsonStart);
    if (machineEnd < 0) throw new Error('codex-task-dispatchのmachine payload終端が不正です。');
    const humanStart = machineEnd + '\n-->\n'.length;
    const closeStart = normalized.indexOf(`\n${DISPATCH_CLOSE}`, humanStart);
    if (closeStart < 0) throw new Error('codex-task-dispatchのclose markerがありません。');
    rawBlocks.push({
      json: normalized.slice(jsonStart, machineEnd),
      human: normalized.slice(humanStart, closeStart),
    });
    cursor = closeStart + 1 + DISPATCH_CLOSE.length;
    if (!normalized.startsWith('\n\n', cursor)) {
      throw new Error('task block後には次のblockまたはterminal result markerだけを置けます。');
    }
    cursor += 2;
  }

  const resultText = normalized.slice(cursor);
  const marker = issueFlow.dispatchMarker(resultText);
  if (!marker || !resultText.startsWith('<!-- codex-actions-dispatch:v1 ')
      || !resultText.endsWith(' -->') || resultText.includes('\n')) {
    throw new Error('dispatch comment末尾のActions markerまたは全体grammarが不正です。');
  }
  if (rawBlocks.length === 0) throw new Error('codex-task-dispatch blockがありません。');
  return { rawBlocks, marker };
}

function validateTaskDispatchBlocks(rawBlocks, expected) {
  const blocks = [];
  for (const raw of rawBlocks) {
    let task;
    try {
      task = JSON.parse(raw.json);
    } catch {
      throw new Error('codex-task-dispatch payloadが正しいJSONではありません。');
    }
    const human = raw.human;
    const expectedHeading = `## ${task && task.key}: ${task && task.title && issueFlow.renderVisibleText(task.title)}`;
    if (!human || human.split('\n', 1)[0] !== expectedHeading) {
      throw new Error('codex-task-dispatchの人間向け見出しがmachine payloadと一致しません。');
    }
    if (/<!--\s*\/?codex-(?:task-dispatch|issue-flow)\b/.test(human)) {
      throw new Error('codex-task-dispatchの人間向け表示に予約markerは記載できません。');
    }
    blocks.push({ task: validateTaskPayload(task, expected), human });
  }
  const taskKeys = new Set();
  const dispatchIds = new Set();
  for (const { task } of blocks) {
    if (taskKeys.has(task.key)) throw new Error(`task keyが重複しています: ${task.key}`);
    if (dispatchIds.has(task.dispatchId)) throw new Error(`dispatchIdが重複しています: ${task.dispatchId}`);
    taskKeys.add(task.key);
    dispatchIds.add(task.dispatchId);
  }
  return blocks;
}

function parseTaskDispatchBlocks(body, expected) {
  const envelope = parseDispatchCommentEnvelope(body);
  return validateTaskDispatchBlocks(envelope.rawBlocks, expected);
}

function planHash(body) {
  return issueFlow.planHash(body);
}

function samePlanIdentity(marker, approvedPlan) {
  return marker.revision === approvedPlan.revision
    && marker.planSha256 === approvedPlan.planSha256
    && marker.sourceSha256 === approvedPlan.sourceSha256
    && marker.sourceOwnerCommentId === approvedPlan.sourceOwnerCommentId
    && (approvedPlan.planCommentId === undefined
      || marker.planCommentId === approvedPlan.planCommentId);
}

function compareComments(left, right) {
  const leftTime = Date.parse(left && left.created_at);
  const rightTime = Date.parse(right && right.created_at);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    throw new Error('commentのcreated_atが不正なため時系列を検証できません。');
  }
  if (!Number.isSafeInteger(left.id) || left.id < 1
      || !Number.isSafeInteger(right.id) || right.id < 1) {
    throw new Error('comment IDが不正なため時系列を検証できません。');
  }
  return leftTime - rightTime || left.id - right.id;
}

function workflowDispatchRequest(context) {
  const payload = context && context.payload ? context.payload : {};
  const inputs = payload.inputs || {};
  if (!context || context.eventName !== 'workflow_dispatch'
      || !payload.repository || payload.repository.full_name !== PARENT_REPOSITORY
      || !/^[1-9]\d*$/.test(inputs.issue_number || '')
      || !/^[1-9]\d*$/.test(inputs.dispatch_comment_id || '')) return null;
  const issueNumber = Number(inputs.issue_number);
  const dispatchCommentId = Number(inputs.dispatch_comment_id);
  if (!Number.isSafeInteger(issueNumber) || !Number.isSafeInteger(dispatchCommentId)) return null;
  return { issueNumber, dispatchCommentId };
}

function trustedDispatchCommentForRequest(comments, context) {
  const request = workflowDispatchRequest(context);
  if (!request) return null;
  const comment = comments.find((candidate) => candidate.id === request.dispatchCommentId);
  return issueFlow.isTrustedActionsComment(comment) ? comment : null;
}

function isCurrentTrustedDispatchResult(comments, context) {
  const eventComment = trustedDispatchCommentForRequest(comments, context);
  const repositoryOwner = context.payload.repository && context.payload.repository.owner;
  if (!eventComment || !repositoryOwner) return false;
  const marker = issueFlow.dispatchMarker(eventComment.body);
  const authoritative = issueFlow.latestAuthoritativeState(comments);
  const stateMatches = marker && authoritative && samePlanIdentity(marker, authoritative.state)
    && authoritative.state.approvalCommentId === marker.approvalCommentId
    && authoritative.state.state === 'approved'
    && authoritative.state.dispatchCommentId === eventComment.id;
  if (!stateMatches) return false;
  const latestOwner = issueFlow.latestRepositoryOwnerComment(comments, repositoryOwner);
  return Boolean(latestOwner && latestOwner.id === marker.approvalCommentId
    && issueFlow.isTrustedOwnerApproval(latestOwner, repositoryOwner));
}

function isCurrentPreparationFailure(comments, context) {
  const dispatchComment = trustedDispatchCommentForRequest(comments, context);
  const repositoryOwner = context.payload.repository && context.payload.repository.owner;
  if (!dispatchComment || !repositoryOwner) return false;
  const authoritative = issueFlow.latestAuthoritativeState(comments);
  if (!authoritative || authoritative.state.state !== 'approved'
      || authoritative.state.dispatchCommentId !== dispatchComment.id) return false;
  const latestOwner = issueFlow.latestRepositoryOwnerComment(comments, repositoryOwner);
  return Boolean(latestOwner && latestOwner.id === authoritative.state.approvalCommentId
    && issueFlow.isTrustedOwnerApproval(latestOwner, repositoryOwner));
}

async function listAllComments(github, owner, repo, issueNumber) {
  return github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });
}

async function prepareDispatch({ github, context, core }) {
  const payload = context.payload || {};
  const request = workflowDispatchRequest(context);
  if (!request) return null;
  const { issueNumber } = request;
  const [owner, repo] = PARENT_REPOSITORY.split('/');
  const issueResponse = await github.rest.issues.get({ owner, repo, issue_number: issueNumber });
  if (!issueResponse.data || issueResponse.data.pull_request) {
    throw new Error('workflow_dispatch inputは親Issueを指す必要があります。');
  }
  const comments = await listAllComments(github, owner, repo, issueNumber);
  const freshDispatch = trustedDispatchCommentForRequest(comments, context);
  if (!freshDispatch) return null;
  const authoritative = issueFlow.latestAuthoritativeState(comments);
  if (!authoritative || authoritative.state.state !== 'approved'
      || authoritative.state.dispatchCommentId !== freshDispatch.id) return null;
  const body = normalizeText(freshDispatch.body);
  const envelope = parseDispatchCommentEnvelope(body);
  const { marker } = envelope;
  const stateMatchesDispatch = authoritative
    && samePlanIdentity(marker, authoritative.state)
    && authoritative.state.state === 'approved'
    && authoritative.state.dispatchCommentId === freshDispatch.id
    && authoritative.state.approvalCommentId === marker.approvalCommentId;
  if (!stateMatchesDispatch) {
    throw new Error('dispatchが最新のActions authoritative approved stateと一致しません。');
  }
  const approvalComment = comments.find((comment) => comment.id === marker.approvalCommentId);
  const sourceComment = comments.find((comment) => comment.id === marker.sourceOwnerCommentId);
  const planComment = comments.find((comment) => comment.id === marker.planCommentId);
  const repositoryOwner = payload.repository.owner;
  if (!issueFlow.isTrustedOwnerApproval(approvalComment, repositoryOwner)
      || !issueFlow.isTrustedOwnerCommand(sourceComment, repositoryOwner)
      || !issueFlow.isTrustedCodexComment(planComment)) {
    throw new Error('source、plan、approvalのauthorを検証できません。');
  }
  if (compareComments(sourceComment, planComment) >= 0
      || compareComments(planComment, approvalComment) >= 0
      || compareComments(approvalComment, freshDispatch) >= 0) {
    throw new Error('source、plan、approval、dispatchの時系列が不正です。');
  }
  const interveningOwnerComment = comments.find((comment) => issueFlow.isRepositoryOwnerComment(comment, repositoryOwner)
    && !issueFlow.isTrustedOwnerApproval(comment, repositoryOwner)
    && compareComments(sourceComment, comment) < 0 && compareComments(comment, approvalComment) < 0);
  const latestOwner = issueFlow.latestRepositoryOwnerComment(comments, repositoryOwner);
  if (interveningOwnerComment || !latestOwner || latestOwner.id !== approvalComment.id
      || !issueFlow.isTrustedOwnerApproval(latestOwner, repositoryOwner)) {
    throw new Error('dispatchが要件変更のない最新repository owner approvalに対応していません。');
  }
  const semantic = issueFlow.parseSemanticResult(planComment.body);
  if (!semantic || !['plan', 'revise'].includes(semantic.type)
      || planHash(planComment.body) !== marker.planSha256) {
    throw new Error('Actions authoritative stateのplan commentが改変または不正です。');
  }
  const currentSourceHash = issueFlow.sourceHash({
    repository: PARENT_REPOSITORY,
    issue: issueResponse.data,
    comments,
    repositoryOwner,
    sourceOwnerCommentId: marker.sourceOwnerCommentId,
  });
  if (currentSourceHash !== marker.sourceSha256) {
    throw new Error('Actions authoritative stateのsource hashが現在のIssue stateと一致しません。');
  }
  const approvedPlan = {
    revision: marker.revision,
    planSha256: marker.planSha256,
    sourceSha256: marker.sourceSha256,
    sourceOwnerCommentId: marker.sourceOwnerCommentId,
  };
  const expected = {
    parentIssue: { repository: PARENT_REPOSITORY, number: issueNumber },
    approvedPlan,
  };
  const blocks = validateTaskDispatchBlocks(envelope.rawBlocks, expected);
  const projectedTasks = semantic.candidates.map((candidate) =>
    issueFlow.projectCandidate(candidate, authoritative.state, issueNumber));
  if (projectedTasks.length !== blocks.length
      || projectedTasks.some((task, index) =>
        issueFlow.canonicalJson(task) !== issueFlow.canonicalJson(blocks[index].task))) {
    throw new Error('dispatch taskが承認済みcandidate planの一対一projectionではありません。');
  }
  const prepared = {
    version: 1,
    parentIssue: {
      repository: PARENT_REPOSITORY,
      number: issueNumber,
      url: expectedParentIssueUrl(PARENT_REPOSITORY, issueNumber),
    },
    approvedPlan,
    tasks: blocks.map(({ task }) => task),
  };
  if (core) core.info(`${prepared.tasks.length}件の承認済みtask dispatchを検証しました。`);
  return prepared;
}

function validatePreparedDispatch(prepared) {
  assertExactKeys(prepared, ['version', 'parentIssue', 'approvedPlan', 'tasks'], 'prepared dispatch');
  if (prepared.version !== 1) throw new Error('prepared dispatch versionは1である必要があります。');
  validateParentIssue(prepared.parentIssue, {
    repository: PARENT_REPOSITORY,
    number: prepared.parentIssue.number,
  });
  validateApprovedPlan({
    revision: prepared.approvedPlan.revision,
    sha256: prepared.approvedPlan.planSha256,
    sourceSha256: prepared.approvedPlan.sourceSha256,
    sourceOwnerCommentId: prepared.approvedPlan.sourceOwnerCommentId,
  });
  if (!Array.isArray(prepared.tasks) || prepared.tasks.length === 0) {
    throw new Error('prepared dispatchにtaskがありません。');
  }
  const expected = {
    parentIssue: prepared.parentIssue,
    approvedPlan: prepared.approvedPlan,
  };
  const keys = new Set();
  prepared.tasks.forEach((task) => {
    validateTaskPayload(task, expected);
    if (keys.has(task.key)) throw new Error(`prepared dispatchのtask keyが重複しています: ${task.key}`);
    keys.add(task.key);
  });
  return prepared;
}

function childIssueMarker(dispatchId) {
  if (!DISPATCH_ID_PATTERN.test(dispatchId)) throw new Error('child Issue markerのdispatchIdが不正です。');
  return `${CHILD_MARKER_PREFIX}dispatch-id=${dispatchId} -->`;
}

function childIssueTitle(task) {
  return `[${task.key}] ${task.title.replace(/@/g, '＠')}`;
}

function trackingMarker(prepared) {
  return `${TRACKING_MARKER_PREFIX}parent=${prepared.parentIssue.repository}#${prepared.parentIssue.number} revision=${prepared.approvedPlan.revision} plan-sha256=${prepared.approvedPlan.planSha256} -->`;
}

function preparationFailureMarker(context) {
  const request = workflowDispatchRequest(context);
  if (!request) throw new Error('信頼できるworkflow_dispatch inputではありません。');
  return `${PREPARATION_FAILURE_MARKER_PREFIX}parent=${PARENT_REPOSITORY}#${request.issueNumber} dispatch-comment-id=${request.dispatchCommentId} -->`;
}

function buildPreparationFailureBody(context) {
  return [
    '## 子タスク配送の検証失敗',
    '',
    '配送コメントを安全に検証できなかったため、child Issueは作成していません。承認済み計画とdispatch形式を確認し、必要なら新しいowner指示から再実行してください。',
    '',
    '安全のため、検証エラーの詳細や認証情報はこのコメントへ記録していません。',
    '',
    preparationFailureMarker(context),
  ].join('\n');
}

function escapeMentions(value) {
  return normalizeText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, '&#64;');
}

function bulletList(items, emptyText = 'なし') {
  if (!items.length) return emptyText;
  return items.map((item) => `- ${escapeMentions(item)}`).join('\n');
}

function dependencyTable(dependencies) {
  if (!dependencies.length) return 'なし';
  const header = '| 対象 | type | gate | 完了条件 | 計画時の根拠 |\n|---|---|---|---|---|';
  const cell = (value) => escapeMentions(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  const rows = dependencies.map((dependency) => `| ${cell(dependency.target)} | ${dependency.type} | ${dependency.gate} | ${cell(dependency.completion)} | ${cell(dependency.evidence)} |`);
  return [header, ...rows].join('\n');
}

function agentStrategyGuidance(strategy) {
  const guidance = {
    'parent-only': 'Main自身が実装とself reviewを行い、WorkerまたはReviewerを追加しません。',
    'worker-parent-review': '1人以上のWorkerが担当範囲を実装してself reviewし、Mainが全成果を統合してdiffと検証結果を直接reviewします。',
    'worker-reviewer-parent': '1人以上のWorkerが担当範囲を実装してself reviewし、Mainが全成果を統合した後、1人以上の独立Reviewerがその統合差分をreviewし、Mainがdiffと検証結果を最終reviewします。',
  };
  return guidance[strategy];
}

function documentationGuidance(documentation) {
  if (documentation.mode === 'explicit-update') {
    return [
      '- このtaskではdocumentation本文の更新が承認範囲に明示的に含まれています。',
      '- work、out-of-scope、completionに従い、承認された文書と内容だけを更新します。追加の文書範囲が必要なら実装へ混ぜず再承認へ戻します。',
      bulletList(documentation.followUp),
    ];
  }
  return [
    '- 通常の実装taskではREADME、docs、利用者・開発者向け文書を変更しません。',
    '- 必要な影響は `documentation follow-up required` として実施結果へ記録し、明示的なdocumentation taskへ委ねます。',
    bulletList(documentation.followUp),
  ];
}

function buildChildIssueBody(task) {
  const runtimePolicy = executionPolicy.resolveExecutionPolicy({
    runtime: { context: 'issue-cloud', source: 'trusted-issue-event' },
  });
  const body = [
    childIssueMarker(task.dispatchId),
    '',
    'このIssueは、親Issueで承認されたtaskをそのまま投影した自己完結型execution packetです。内容を確認後、repository ownerがCodex宛ての明示コメントを投稿して実装を開始してください。',
    '',
    '## 識別情報',
    '',
    `- task key: \`${task.key}\``,
    `- task title: ${escapeMentions(task.title)}`,
    `- 対象repository: \`${task.repository}\``,
    `- 親Issue: ${task.parentIssue.url}`,
    `- approved plan: revision \`${task.approvedPlan.revision}\` / SHA-256 \`${task.approvedPlan.sha256}\``,
    `- approved source: owner comment ID \`${task.approvedPlan.sourceOwnerCommentId}\` / SHA-256 \`${task.approvedPlan.sourceSha256}\``,
    `- dispatch-id: \`${task.dispatchId}\``,
    `- priority: \`${task.priority}\``,
    `- agent strategy: \`${task.agentStrategy}\``,
    `- 実行コンテキスト: \`${runtimePolicy.executionContext}\``,
    `- 公開モード: \`${runtimePolicy.mode}\``,
    '- 上記2項目はtrusted Issue eventから開始時に確定したruntime bookkeepingであり、task本文から再判定しません。',
    '',
    '## 実装開始gate',
    '',
    '- 最初に、このIssueの先頭にあるversion 1 marker、対象repository、親Issue、approved plan、dispatch-id、作業内容、対象外、完了条件が相互に一致し、現在のrepositoryが対象repositoryであることを検証します。',
    '- 実装開始直前に依存対象の現在状態もGitHubから再取得します。execution packet全体を検証できない場合は、推測で補わず親Issueの再計画・再配送へ戻します。',
    '- packet検証が完了するまで、source・test変更、branch・commit作成、実装agent起動、実装品質ゲートを開始しません。親Issueや通常の依頼文だけを実装許可として扱いません。',
    '',
    '## agent構成',
    '',
    `- ${agentStrategyGuidance(task.agentStrategy)}`,
    '- agent strategyは人間が承認したagent種別と必須review経路であり、人数や担当範囲を固定しません。Workerを利用する場合、Mainが責務境界、依存関係、変更競合、統合コストから必要最小限を決め、行数やtask規模だけで人数を決めません。',
    '- 同一ファイルの大幅変更、強い依存、または過大な統合負荷がある作業は無理に並列化せず、小さいtaskを並列化のためだけに過剰分割しません。Reviewerを利用するstrategyでは各Workerへの専属配置を要求せず、Worker間の整合性、task全体の仕様充足、責務境界、統合後の問題を確認します。',
    '- sub-agentの報告だけで完了判定せず、指定された親reviewまで完了します。',
    '',
    '## 作業内容',
    '',
    bulletList(task.work),
    '',
    '## 対象外',
    '',
    bulletList(task.outOfScope),
    '',
    '## 完了条件',
    '',
    task.completion.map((item) => `- [ ] ${escapeMentions(item)}`).join('\n'),
    '',
    '## 依存関係',
    '',
    dependencyTable(task.dependencies),
    '',
    '実装開始直前に依存対象の現在状態をGitHubから再取得してください。hard dependencyは指定gateを止め、soft dependencyは独立作業を止めず、ordering dependencyは指定された公開・merge順だけを制約します。待機時は再開条件を記録して終了し、ポーリングしません。',
    '',
    '## 懸念事項',
    '',
    bulletList(task.concerns),
    '',
    '## 検証方針',
    '',
    `- mode: \`${task.verification.mode}\``,
    bulletList(task.verification.steps),
    '- 未実行または失敗した検証を成功扱いにせず、結果と理由を記録します。',
    '',
    '## dependency操作',
    '',
    '- Cloud Environmentのsetupで既存dependencyが導入済みであることを前提とし、承認済みの作業内容にdependency変更が明記されていない限り、探索目的のinstall・update・dependency graphやlockfileの再構築を行いません。',
    '- 禁止対象には `npm install`、`npm i`、`npm ci`、`npm update`、`npm install --package-lock-only`、`yarn install`、`pnpm install`、`composer install`、`composer update` と同等の操作を含みます。既存のcheck・test・lint・buildは検証方針に従って実行できます。',
    '- 新規dependencyが必要なら、なぜ必要か、追加候補、既存標準APIや既存dependencyではなぜ不足するかを報告し、installを試す前にscope変更として再計画・再承認へ戻します。',
    '',
    '## ユーザー向け出力',
    '',
    '- 質問、進捗、検証、review対応、完了報告、Pull Request title/body、documentation follow-upなどの人間向けMarkdownは日本語で記載します。',
    '- machine-readable marker・JSON、identifier、command、username・repository・branch・package名、原文エラーは変更しません。',
    '',
    '## 公開ルール',
    '',
    '- 実装、必要な検証、self review、指定されたagent review、commit、完了報告までを行います。',
    '- GitHub login、credential追加、push、APIやpluginによるremote branch公開、Pull Request作成は試行しません。',
    `- 公開モード \`${runtimePolicy.mode}\` に従い、完了後はCodex Web UIからPull Requestを公開するようユーザーへ案内します。`,
    '',
    '## documentation方針',
    '',
    `- mode: \`${task.documentation.mode}\``,
    ...documentationGuidance(task.documentation),
  ].join('\n');
  if (/@codex/i.test(body)) throw new Error('child Issue本文に自動メンションが残っています。');
  return body;
}

async function listAllRepositoryIssues(github, repository) {
  const [owner, repo] = repository.split('/');
  return github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'all',
    per_page: 100,
  });
}

function findExistingChildIssue(issues, task) {
  const marker = childIssueMarker(task.dispatchId);
  return issues.find((issue) => {
    if (issue.pull_request || typeof issue.body !== 'string') return false;
    if (!issue.user
        || issue.user.login !== TRUSTED_CHILD_ISSUE_CREATOR.login
        || issue.user.type !== TRUSTED_CHILD_ISSUE_CREATOR.type
        || issue.author_association !== TRUSTED_CHILD_ISSUE_CREATOR.authorAssociation) return false;
    const body = normalizeText(issue.body);
    return (body === marker || body.startsWith(`${marker}\n`))
      && countOccurrences(body, marker) === 1;
  }) || null;
}

function requireCrossRepoToken(token) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Actions Secret CROSS_REPO_ISSUE_TOKEN is not configured.');
  }
  return true;
}

function missingTokenDispatchResult(prepared) {
  validatePreparedDispatch(prepared);
  return {
    version: 1,
    items: [],
    failures: prepared.tasks.map((task) => ({
      taskKey: task.key,
      repository: task.repository,
      error: 'CROSS_REPO_ISSUE_TOKENが未設定のためchild Issueを配送できません。',
    })),
  };
}

async function dispatchPrepared({ github, prepared, core }) {
  validatePreparedDispatch(prepared);
  const issuesByRepository = new Map();
  const items = [];
  const failures = [];
  for (const task of prepared.tasks) {
    try {
      let issues = issuesByRepository.get(task.repository);
      if (!issues) {
        issues = await listAllRepositoryIssues(github, task.repository);
        issuesByRepository.set(task.repository, issues);
      }
      const existing = findExistingChildIssue(issues, task);
      if (existing) {
        items.push({
          taskKey: task.key,
          repository: task.repository,
          issueNumber: existing.number,
          url: existing.html_url,
          outcome: 'reused',
        });
        continue;
      }
      const [owner, repo] = task.repository.split('/');
      const response = await github.rest.issues.create({
        owner,
        repo,
        title: childIssueTitle(task),
        body: buildChildIssueBody(task),
      });
      const created = response.data;
      issues.push(created);
      items.push({
        taskKey: task.key,
        repository: task.repository,
        issueNumber: created.number,
        url: created.html_url,
        outcome: 'created',
      });
    } catch (error) {
      const status = Number.isInteger(error && error.status) ? ` (HTTP ${error.status})` : '';
      failures.push({ taskKey: task.key, repository: task.repository, error: `child Issue配送に失敗しました${status}` });
      if (core) core.warning(`${task.key}のchild Issue配送に失敗しました${status}。secretやtokenは出力していません。`);
    }
  }
  return { version: 1, items, failures };
}

function isTrustedActionsComment(comment) {
  const user = comment && comment.user;
  return Boolean(user
    && user.login === TRUSTED_ACTIONS_BOT.login
    && user.id === TRUSTED_ACTIONS_BOT.id
    && user.type === TRUSTED_ACTIONS_BOT.type);
}

function validateDispatchResult(result, prepared) {
  assertExactKeys(result, ['version', 'items', 'failures'], 'dispatch result');
  if (result.version !== 1 || !Array.isArray(result.items) || !Array.isArray(result.failures)) {
    throw new Error('dispatch result形式が不正です。');
  }
  const taskKeys = new Set(prepared.tasks.map((task) => task.key));
  const seen = new Set();
  for (const item of [...result.items, ...result.failures]) {
    if (!item || !taskKeys.has(item.taskKey)) throw new Error('dispatch resultに未知のtaskがあります。');
    if (seen.has(item.taskKey)) throw new Error(`dispatch resultのtaskが重複しています: ${item.taskKey}`);
    seen.add(item.taskKey);
  }
  if (seen.size !== taskKeys.size) throw new Error('dispatch resultに未処理taskがあります。');
  return result;
}

function buildTrackingBody(prepared, result) {
  const lines = [
    '## 子タスク配送状況',
    '',
    `承認済みplan revision \`${prepared.approvedPlan.revision}\`（\`${prepared.approvedPlan.planSha256}\`）の配送結果です。`,
    '',
    '| task | repository | child Issue | 結果 |',
    '|---|---|---|---|',
  ];
  const itemByKey = new Map(result.items.map((item) => [item.taskKey, item]));
  const failureByKey = new Map(result.failures.map((item) => [item.taskKey, item]));
  for (const task of prepared.tasks) {
    const item = itemByKey.get(task.key);
    const failure = failureByKey.get(task.key);
    if (item) {
      lines.push(`| ${task.key} | \`${task.repository}\` | [#${item.issueNumber}](${item.url}) | ${item.outcome === 'created' ? '作成' : '既存を再利用'} |`);
    } else {
      lines.push(`| ${task.key} | \`${task.repository}\` | - | ${failure ? failure.error : '未処理'} |`);
    }
  }
  lines.push(
    '',
    result.failures.length
      ? '未配送taskがあります。原因を解消してworkflowを再実行すると、作成済みIssueを再利用して未配送taskだけを継続します。'
      : '各child Issueの内容を確認し、問題がなければそのIssueでrepository ownerがCodex宛ての明示コメントを投稿してください。',
    '',
    trackingMarker(prepared),
  );
  return lines.join('\n');
}

async function upsertTrackingComment({ github, prepared, result, context, core }) {
  validatePreparedDispatch(prepared);
  validateDispatchResult(result, prepared);
  const [owner, repo] = prepared.parentIssue.repository.split('/');
  const comments = await listAllComments(github, owner, repo, prepared.parentIssue.number);
  const marker = trackingMarker(prepared);
  const existing = comments
    .filter(isTrustedActionsComment)
    .filter((comment) => typeof comment.body === 'string' && comment.body.includes(marker))
    .sort((left, right) => Number(left.id || 0) - Number(right.id || 0))[0];
  const body = buildTrackingBody(prepared, result);
  let tracking;
  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    if (core) core.info('親Issueの既存配送追跡コメントを更新しました。');
    tracking = { outcome: 'updated', commentId: existing.id };
  } else {
    const response = await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: prepared.parentIssue.number,
      body,
    });
    if (core) core.info('親Issueへ配送追跡コメントを作成しました。');
    tracking = { outcome: 'created', commentId: response.data.id };
  }
  const freshComments = await listAllComments(github, owner, repo, prepared.parentIssue.number);
  if (isCurrentTrustedDispatchResult(freshComments, context)) {
    const nextState = result.failures.length ? 'Codex:要判断' : 'Codex:子タスク確認待ち';
    await issueFlow.synchronizeIssueState(
      github,
      owner,
      repo,
      prepared.parentIssue.number,
      nextState,
    );
  } else if (core) {
    core.info('より新しいowner commandまたはtrusted resultがあるため、配送履歴だけを更新してstate labelは変更しません。');
  }
  return tracking;
}

async function upsertPreparationFailure({ github, context, core }) {
  const request = workflowDispatchRequest(context);
  if (!request) return null;
  const [owner, repo] = PARENT_REPOSITORY.split('/');
  const issueNumber = request.issueNumber;
  const issueResponse = await github.rest.issues.get({ owner, repo, issue_number: issueNumber });
  if (!issueResponse.data || issueResponse.data.pull_request) return null;
  const comments = await listAllComments(github, owner, repo, issueNumber);
  if (!isCurrentPreparationFailure(comments, context)) return null;
  const marker = preparationFailureMarker(context);
  const existing = comments
    .filter(isTrustedActionsComment)
    .filter((comment) => typeof comment.body === 'string'
      && countOccurrences(comment.body, marker) === 1
      && normalizeText(comment.body).endsWith(marker))
    .sort((left, right) => Number(left.id || 0) - Number(right.id || 0))[0];
  const body = buildPreparationFailureBody(context);
  let tracking;
  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    tracking = { outcome: 'updated', commentId: existing.id };
  } else {
    const response = await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    tracking = { outcome: 'created', commentId: response.data.id };
  }
  const freshComments = await listAllComments(github, owner, repo, issueNumber);
  if (isCurrentPreparationFailure(freshComments, context)) {
    await issueFlow.synchronizeIssueState(github, owner, repo, issueNumber, 'Codex:要判断');
  } else if (core) {
    core.info('より新しいowner commandまたはtrusted resultがあるため、検証失敗履歴だけを更新してstate labelは変更しません。');
  }
  if (core) core.info('親Issueへgenericな配送検証失敗を記録しました。');
  return tracking;
}

module.exports = {
  AGENT_STRATEGIES,
  ALLOWED_REPOSITORIES,
  PARENT_REPOSITORY,
  TRUSTED_ACTIONS_BOT,
  TRUSTED_CHILD_ISSUE_CREATOR,
  buildChildIssueBody,
  buildPreparationFailureBody,
  buildTrackingBody,
  childIssueTitle,
  childIssueMarker,
  computeDispatchId,
  dispatchPrepared,
  findExistingChildIssue,
  missingTokenDispatchResult,
  parseDispatchCommentEnvelope,
  parseTaskDispatchBlocks,
  planHash,
  prepareDispatch,
  preparationFailureMarker,
  requireCrossRepoToken,
  trackingMarker,
  upsertTrackingComment,
  upsertPreparationFailure,
  validatePreparedDispatch,
  validateTaskPayload,
};
