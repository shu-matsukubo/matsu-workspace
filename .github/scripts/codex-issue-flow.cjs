'use strict';

const crypto = require('node:crypto');

const CODEX_BOT = Object.freeze({ login: 'chatgpt-codex-connector[bot]', id: 199175422, type: 'Bot' });
const ACTIONS_BOT = Object.freeze({ login: 'github-actions[bot]', id: 41898282, type: 'Bot' });
const PARENT_REPOSITORY = 'shu-matsukubo/matsu-workspace';
const ALLOWED_REPOSITORIES = Object.freeze([
  'shu-matsukubo/matsu-front', 'shu-matsukubo/matsu-bff', 'shu-matsukubo/matsu-api',
  'shu-matsukubo/matsu-auth', 'shu-matsukubo/matsu-toolbox-api',
  'shu-matsukubo/matsu-arcade-auth', 'shu-matsukubo/matsu-arcade-api',
  'shu-matsukubo/matsu-docs',
]);
const ALLOWED_REPOSITORY_SET = new Set(ALLOWED_REPOSITORIES);
const AGENT_STRATEGIES = new Set(['parent-only', 'worker-parent-review', 'worker-reviewer-parent']);
const PRIORITIES = new Set(['high', 'normal', 'low']);
const VERIFICATION_MODES = new Set(['normal', 'issue-ci-delegated']);
const DOCUMENTATION_MODES = new Set(['follow-up-only', 'explicit-update']);
const DEPENDENCY_TYPES = new Set(['hard', 'soft', 'ordering']);
const DEPENDENCY_GATES = new Set(['start', 'complete', 'publish', 'merge']);
const AUTHORITATIVE_STATES = new Set(['awaiting-approval', 'question', 'error', 'approval-verified', 'approved']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TASK_KEY_PATTERN = /^[A-Z][A-Z0-9_-]{0,31}$/;
const CANDIDATE_OPEN = '<!-- codex-plan-candidate:v1';
const CANDIDATE_CLOSE = '<!-- /codex-plan-candidate:v1 -->';
const SEMANTIC_PATTERN = /^<!-- codex-semantic-result:v1 type=(plan|revise|question|error) -->$/;
const CONNECTOR_FOOTER_PATTERN = /^ ?\[View task →\]\((https:\/\/chatgpt\.com\/s\/([A-Za-z0-9][A-Za-z0-9_-]{0,255}))\)$/;
const STATE_PREFIX = '<!-- codex-issue-state:v1 ';
const DISPATCH_PREFIX = '<!-- codex-actions-dispatch:v1 ';
const APPROVAL_RESULT_PREFIX = '<!-- codex-approval-result:v1 ';

const LEGACY_COMMAND_LABELS = Object.freeze(['Codex:回答済', 'Codex:差し戻し', 'Codex:承認']);
const STATE_LABELS = Object.freeze([
  'Codex:処理中', 'Codex:回答待ち', 'Codex:承認待ち', 'Codex:依存待ち',
  'Codex:要判断', 'Codex:子タスク確認待ち', 'Codex:PR作成済',
]);
const LABEL_SPECS = Object.freeze([
  ['Codex:処理中', '5319e7', 'Actions管理: Codexの処理開始から結果コメントまで'],
  ['Codex:回答待ち', 'fbca04', 'Actions管理: ユーザー回答待ち'],
  ['Codex:承認待ち', 'c2e0c6', 'Actions管理: 最新計画の承認待ち'],
  ['Codex:依存待ち', 'f9d0c4', 'Actions管理: hard dependencyの完了待ち'],
  ['Codex:要判断', 'b60205', 'Actions管理: 循環・前提変更・安全性の判断待ち'],
  ['Codex:子タスク確認待ち', '1d76db', 'Actions管理: 配送済みchild Issueのユーザー確認待ち'],
  ['Codex:PR作成済', '0e8a16', 'Actions管理: draft Pull Request作成済み'],
].map(([name, color, description]) => Object.freeze({ name, color, description })));

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').normalize('NFC');
}

function escapeUnsafeJsonCharacters(value) {
  const escapes = { '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '@': '\\u0040', '`': '\\u0060' };
  return String(value).replace(/[<>&@`]/g, (character) => escapes[character]);
}

function stringifyMachineJson(value) {
  return escapeUnsafeJsonCharacters(JSON.stringify(value));
}

function canonicalizeForDisplay(value) {
  if (Array.isArray(value)) return value.map(canonicalizeForDisplay);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareOrdinal)
      .map((key) => [key, canonicalizeForDisplay(value[key])]));
  }
  return value;
}

function renderVisibleText(value) {
  return escapeUnsafeJsonCharacters(normalizeText(value));
}

function renderCandidateHuman(candidate) {
  const json = escapeUnsafeJsonCharacters(JSON.stringify(canonicalizeForDisplay(candidate), null, 2));
  return [`## ${candidate.key}: ${renderVisibleText(candidate.title)}`, '', '承認対象task payload', '',
    '```json', json, '```'].join('\n');
}

function compareOrdinal(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function byCreatedAtAndId(left, right) {
  const time = compareOrdinal(left && left.created_at, right && right.created_at);
  return time || Number(left && left.id || 0) - Number(right && right.id || 0);
}

function sameUser(actual, expected) {
  return Boolean(actual && expected && actual.id === expected.id && actual.login === expected.login
    && (!expected.type || actual.type === expected.type));
}

function isIssueCommentOnPullRequest(payload) {
  return Boolean(payload.issue && payload.issue.pull_request);
}

function containsCodexMention(body) {
  return /(?:^|[^A-Za-z0-9_-])@codex(?![A-Za-z0-9_-])/i.test(body || '');
}

function isExactApprovalCommand(body) {
  return normalizeText(body).trim() === '/codex approve';
}

function isRepositoryOwnerComment(comment, repositoryOwner) {
  return Boolean(comment && sameUser(comment.user, repositoryOwner));
}

function isTrustedOwnerCommand(comment, repositoryOwner) {
  return isRepositoryOwnerComment(comment, repositoryOwner) && containsCodexMention(comment.body);
}

function isTrustedOwnerApproval(comment, repositoryOwner) {
  return isRepositoryOwnerComment(comment, repositoryOwner) && isExactApprovalCommand(comment.body);
}

function isOwnerControlComment(comment, repositoryOwner) {
  return isTrustedOwnerCommand(comment, repositoryOwner) || isTrustedOwnerApproval(comment, repositoryOwner);
}

function isTrustedCodexComment(comment) {
  return Boolean(comment && sameUser(comment.user, CODEX_BOT));
}

function isTrustedActionsComment(comment) {
  return Boolean(comment && sameUser(comment.user, ACTIONS_BOT));
}

function latestComment(comments, predicate) {
  return comments.filter(predicate).sort(byCreatedAtAndId).at(-1) || null;
}

function latestTrustedOwnerCommand(comments, repositoryOwner) {
  return latestComment(comments, (comment) => isTrustedOwnerCommand(comment, repositoryOwner));
}

function latestOwnerControlComment(comments, repositoryOwner) {
  return latestComment(comments, (comment) => isOwnerControlComment(comment, repositoryOwner));
}

function latestRepositoryOwnerComment(comments, repositoryOwner) {
  return latestComment(comments, (comment) => isRepositoryOwnerComment(comment, repositoryOwner));
}

function assertPlainObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}はobjectである必要があります。`);
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
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path}は空でない文字列である必要があります。`);
}

function assertStringArray(value, path, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${path}は${allowEmpty ? '' : '空でない'}文字列配列である必要があります。`);
  }
  value.forEach((item, index) => assertNonEmptyString(item, `${path}[${index}]`));
}

function validateDependencies(dependencies) {
  if (!Array.isArray(dependencies)) throw new Error('dependenciesは配列である必要があります。');
  dependencies.forEach((dependency, index) => {
    const itemPath = `dependencies[${index}]`;
    assertExactKeys(dependency, ['target', 'type', 'gate', 'completion', 'evidence'], itemPath);
    assertNonEmptyString(dependency.target, `${itemPath}.target`);
    assertNonEmptyString(dependency.completion, `${itemPath}.completion`);
    assertNonEmptyString(dependency.evidence, `${itemPath}.evidence`);
    if (!DEPENDENCY_TYPES.has(dependency.type)) throw new Error(`${itemPath}.typeが未対応です。`);
    if (!DEPENDENCY_GATES.has(dependency.gate)) throw new Error(`${itemPath}.gateが未対応です。`);
    if (dependency.type === 'ordering' && ['start', 'complete'].includes(dependency.gate)) {
      throw new Error(`${itemPath}のordering dependencyにstart/complete gateは指定できません。`);
    }
  });
}

function validateCandidateTask(candidate) {
  assertExactKeys(candidate, [
    'version', 'key', 'title', 'repository', 'priority', 'agentStrategy', 'work',
    'outOfScope', 'completion', 'dependencies', 'concerns', 'verification', 'documentation',
  ], 'candidate task');
  if (candidate.version !== 1) throw new Error('candidate task versionは1である必要があります。');
  if (typeof candidate.key !== 'string' || !TASK_KEY_PATTERN.test(candidate.key)) throw new Error('candidate task key形式が不正です。');
  assertNonEmptyString(candidate.title, 'candidate title');
  if (/\r|\n/.test(candidate.title) || candidate.title.length > 256) throw new Error('candidate title形式が不正です。');
  if (!ALLOWED_REPOSITORY_SET.has(candidate.repository)) throw new Error(`allowlist外repositoryです: ${candidate.repository}`);
  if (!PRIORITIES.has(candidate.priority)) throw new Error('candidate priorityが未対応です。');
  if (!AGENT_STRATEGIES.has(candidate.agentStrategy)) throw new Error('candidate agentStrategyが未対応です。');
  assertStringArray(candidate.work, 'candidate work', { allowEmpty: false });
  assertStringArray(candidate.outOfScope, 'candidate outOfScope');
  assertStringArray(candidate.completion, 'candidate completion', { allowEmpty: false });
  validateDependencies(candidate.dependencies);
  assertStringArray(candidate.concerns, 'candidate concerns');
  assertExactKeys(candidate.verification, ['mode', 'steps'], 'candidate verification');
  if (!VERIFICATION_MODES.has(candidate.verification.mode)) throw new Error('candidate verification.modeが未対応です。');
  assertStringArray(candidate.verification.steps, 'candidate verification.steps', { allowEmpty: false });
  assertExactKeys(candidate.documentation, ['mode', 'followUp'], 'candidate documentation');
  if (!DOCUMENTATION_MODES.has(candidate.documentation.mode)) throw new Error('candidate documentation.modeが未対応です。');
  assertStringArray(candidate.documentation.followUp, 'candidate documentation.followUp');
  return candidate;
}

function isValidConnectorFooter(footer) {
  const match = CONNECTOR_FOOTER_PATTERN.exec(footer);
  if (!match) return false;
  try {
    const url = new URL(match[1]);
    return url.protocol === 'https:' && url.username === '' && url.password === ''
      && url.hostname === 'chatgpt.com' && url.port === '' && url.pathname === `/s/${match[2]}`
      && url.search === '' && url.hash === '';
  } catch {
    return false;
  }
}

function terminalSemanticResultMarker(body) {
  const lines = normalizeText(body).replace(/\n+$/g, '').split('\n');
  let markerIndex = lines.length - 1;
  if (isValidConnectorFooter(lines.at(-1) || '')) {
    if (lines.at(-2) !== '') return null;
    markerIndex -= 2;
  }
  const match = SEMANTIC_PATTERN.exec(lines[markerIndex] || '');
  return match ? { type: match[1] } : null;
}

function semanticResultEnvelope(body) {
  const normalized = normalizeText(body).replace(/\n+$/g, '');
  const marker = terminalSemanticResultMarker(normalized);
  const occurrences = normalized.match(/<!-- codex-semantic-result:v1 type=(?:plan|revise|question|error) -->/g) || [];
  if (occurrences.length === 0) return null;
  if (occurrences.length !== 1) throw new Error('semantic result markerは末尾に1つだけ記載する必要があります。');
  if (!marker) throw new Error('semantic result marker後には既知のConnector footer以外を記載できません。');
  const markerText = `<!-- codex-semantic-result:v1 type=${marker.type} -->`;
  const markerIndex = normalized.indexOf(markerText);
  if (markerIndex > 0 && normalized[markerIndex - 1] !== '\n') {
    throw new Error('semantic result markerは独立した行に記載する必要があります。');
  }
  const suffix = normalized.slice(markerIndex + markerText.length);
  if (suffix !== '' && (!suffix.startsWith('\n\n') || !isValidConnectorFooter(suffix.slice(2)))) {
    throw new Error('semantic result marker後のConnector footerが不正です。');
  }
  return { type: marker.type, markerIndex,
    protocolBody: normalized.slice(0, markerIndex + markerText.length) };
}

function semanticResultMarker(body) {
  const envelope = semanticResultEnvelope(body);
  return envelope ? { type: envelope.type } : null;
}

function parsePlanCandidates(body) {
  const envelope = semanticResultEnvelope(body);
  if (!envelope || !['plan', 'revise'].includes(envelope.type)) throw new Error('plan candidateのsemantic result markerが不正です。');
  let normalized = envelope.protocolBody.slice(0, envelope.markerIndex);
  if (!normalized.endsWith('\n\n')) throw new Error('candidate blockとsemantic result markerの境界が不正です。');
  normalized = normalized.slice(0, -2);
  if (!normalized.startsWith(`${CANDIDATE_OPEN}\n`)) throw new Error('plan resultはcandidate blockから開始する必要があります。');

  const candidates = [];
  let cursor = 0;
  while (normalized.startsWith(`${CANDIDATE_OPEN}\n`, cursor)) {
    const jsonStart = cursor + CANDIDATE_OPEN.length + 1;
    const machineEnd = normalized.indexOf('\n-->\n', jsonStart);
    if (machineEnd < 0) throw new Error('candidate machine payload終端が不正です。');
    const humanStart = machineEnd + '\n-->\n'.length;
    const closeStart = normalized.indexOf(`\n${CANDIDATE_CLOSE}`, humanStart);
    if (closeStart < 0) throw new Error('candidate close markerがありません。');
    let candidate;
    const machineJson = normalized.slice(jsonStart, machineEnd);
    if (machineJson !== escapeUnsafeJsonCharacters(machineJson)) {
      throw new Error('candidate payloadのunsafe文字はUnicode escapeする必要があります。');
    }
    try { candidate = JSON.parse(machineJson); }
    catch { throw new Error('candidate payloadが正しいJSONではありません。'); }
    validateCandidateTask(candidate);
    const human = normalized.slice(humanStart, closeStart);
    if (human !== renderCandidateHuman(candidate)) {
      throw new Error('candidateの人間向け表示全体がmachine payloadと一致しません。');
    }
    candidates.push(candidate);
    cursor = closeStart + 1 + CANDIDATE_CLOSE.length;
    if (cursor === normalized.length) break;
    if (!normalized.startsWith('\n\n', cursor)) throw new Error('candidate block間のgrammarが不正です。');
    cursor += 2;
  }
  if (cursor !== normalized.length || candidates.length === 0) throw new Error('candidate block全体のgrammarが不正です。');
  const keys = new Set();
  for (const candidate of candidates) {
    if (keys.has(candidate.key)) throw new Error(`candidate task keyが重複しています: ${candidate.key}`);
    keys.add(candidate.key);
  }
  return { type: envelope.type, candidates };
}

function parseSemanticResult(body) {
  const envelope = semanticResultEnvelope(body);
  if (!envelope) return null;
  if (['plan', 'revise'].includes(envelope.type)) return parsePlanCandidates(body);
  const content = envelope.protocolBody.slice(0, envelope.markerIndex);
  if (/<!--\s*\/?codex-(?:plan-candidate|semantic-result|issue-state|actions-dispatch)\b/i.test(content)) {
    throw new Error('question/error result本文に予約markerは記載できません。');
  }
  return { type: envelope.type, candidates: [] };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(compareOrdinal).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function planHash(body) {
  const envelope = semanticResultEnvelope(body);
  const protocolBody = envelope ? envelope.protocolBody : body;
  const normalized = normalizeText(protocolBody).split('\n').map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n').replace(/^\n+|\n+$/g, '');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function sourceHash({ repository, issue, comments, repositoryOwner, sourceOwnerCommentId }) {
  const boundary = comments.find((comment) => comment.id === sourceOwnerCommentId);
  if (!isTrustedOwnerCommand(boundary, repositoryOwner)) throw new Error('source owner commandを一意に検証できません。');
  const ownerComments = comments.filter((comment) => isRepositoryOwnerComment(comment, repositoryOwner))
    .filter((comment) => byCreatedAtAndId(comment, boundary) <= 0).sort(byCreatedAtAndId)
    .map((comment) => ({ id: Number(comment.id), authorId: Number(comment.user.id),
      createdAt: normalizeText(comment.created_at), body: normalizeText(comment.body) }));
  const labels = (issue.labels || []).map((label) => typeof label === 'string' ? label : label.name)
    .map(normalizeText).filter((label) => !STATE_LABELS.includes(label) && !LEGACY_COMMAND_LABELS.includes(label))
    .sort(compareOrdinal);
  const canonical = canonicalJson({
    issue: { repository: normalizeText(repository), number: Number(issue.number),
      title: normalizeText(issue.title), body: normalizeText(issue.body) },
    sourceOwnerCommentId, labels, ownerComments, dependencies: [],
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function parseJsonMarker(body, prefix) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}([^\\r\\n]+) -->`, 'g');
  let match;
  let found = null;
  let count = 0;
  while ((match = pattern.exec(normalizeText(body))) !== null) {
    count += 1;
    try { found = JSON.parse(match[1]); } catch { return null; }
  }
  return count === 1 ? found : null;
}

function validateAuthoritativeState(state) {
  assertExactKeys(state, [
    'version', 'state', 'revision', 'handledOwnerCommentId', 'sourceOwnerCommentId',
    'sourceSha256', 'planSha256', 'planCommentId', 'resultCommentId',
    'approvalCommentId', 'dispatchCommentId',
  ], 'authoritative state');
  if (state.version !== 1 || !AUTHORITATIVE_STATES.has(state.state)) throw new Error('authoritative state形式が不正です。');
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) throw new Error('authoritative revisionが不正です。');
  for (const field of ['handledOwnerCommentId', 'sourceOwnerCommentId', 'resultCommentId']) {
    if (!Number.isSafeInteger(state[field]) || state[field] < 1) throw new Error(`authoritative ${field}が不正です。`);
  }
  if (!SHA256_PATTERN.test(state.sourceSha256)) throw new Error('authoritative source hashが不正です。');
  const hasPlan = ['awaiting-approval', 'approval-verified', 'approved'].includes(state.state);
  if (hasPlan) {
    if (state.revision < 1 || !SHA256_PATTERN.test(state.planSha256)
        || !Number.isSafeInteger(state.planCommentId) || state.planCommentId < 1) {
      throw new Error('authoritative plan identityが不正です。');
    }
  } else if (state.planSha256 !== null || state.planCommentId !== null) throw new Error('question/error stateにplan identityは保持できません。');
  if (state.state === 'approval-verified') {
    if (!Number.isSafeInteger(state.approvalCommentId) || state.approvalCommentId < 1
        || state.dispatchCommentId !== null) throw new Error('approval-verified stateのidentityが不正です。');
  } else if (state.state === 'approved') {
    if (!Number.isSafeInteger(state.approvalCommentId) || state.approvalCommentId < 1
        || !Number.isSafeInteger(state.dispatchCommentId) || state.dispatchCommentId < 1) {
      throw new Error('approved stateのapproval/dispatch identityが不正です。');
    }
  } else if (state.approvalCommentId !== null || state.dispatchCommentId !== null) throw new Error('未承認stateにapproval/dispatch identityは保持できません。');
  return state;
}

function authoritativeStateMarker(body) {
  const normalized = normalizeText(body).replace(/\n+$/g, '');
  const lines = normalized.split('\n');
  const terminal = lines.at(-1) || '';
  if (!terminal.startsWith(STATE_PREFIX) || !terminal.endsWith(' -->')) return null;
  const markerCount = normalized.split(STATE_PREFIX).length - 1;
  if (markerCount !== 1) return null;
  let parsed;
  try { parsed = JSON.parse(terminal.slice(STATE_PREFIX.length, -' -->'.length)); }
  catch { return null; }
  try {
    validateAuthoritativeState(parsed);
    return normalized === stateBody(parsed) ? parsed : null;
  } catch { return null; }
}

function dispatchMarker(body) {
  const parsed = parseJsonMarker(body, DISPATCH_PREFIX);
  if (!parsed) return null;
  try {
    assertExactKeys(parsed, ['version', 'revision', 'approvalCommentId', 'sourceOwnerCommentId',
      'sourceSha256', 'planSha256', 'planCommentId'], 'Actions dispatch marker');
    if (parsed.version !== 1 || !Number.isSafeInteger(parsed.revision) || parsed.revision < 1
        || !Number.isSafeInteger(parsed.approvalCommentId) || parsed.approvalCommentId < 1
        || !Number.isSafeInteger(parsed.sourceOwnerCommentId) || parsed.sourceOwnerCommentId < 1
        || !Number.isSafeInteger(parsed.planCommentId) || parsed.planCommentId < 1
        || !SHA256_PATTERN.test(parsed.sourceSha256) || !SHA256_PATTERN.test(parsed.planSha256)) return null;
    return parsed;
  } catch { return null; }
}

function latestAuthoritativeState(comments) {
  return comments.filter(isTrustedActionsComment)
    .map((comment) => ({ comment, state: authoritativeStateMarker(comment.body) }))
    .filter((item) => item.state).sort((left, right) => byCreatedAtAndId(left.comment, right.comment)).at(-1) || null;
}

function stateBody(state) {
  const messages = {
    'awaiting-approval': ['## Codex計画: 承認待ち', '',
      `plan revision \`${state.revision}\` をActionsが検証しました。承認する場合は、repository ownerが完全一致の \`/codex approve\` を投稿してください。`, '',
      'このコメントのrevision、hash、comment ID、processed stateはGitHub Actionsが管理します。'],
    question: ['## Codex計画: 回答待ち', '',
      'repository ownerは、半角の `@` と `codex` を空白なしで続け、その後に空白と回答を書いてください。'],
    error: ['## Codex計画: 要判断', '', 'Codexの意味結果を安全に計画へ変換できませんでした。',
      'repository ownerは、半角の `@` と `codex` を空白なしで続け、その後に空白と再指示を書いてください。'],
    'approval-verified': ['## Codex計画: 承認検証済み', '',
      `repository ownerの承認を検証しました。plan revision \`${state.revision}\` をChild Task Dispatcherへ投影します。`],
    approved: ['## Codex計画: 承認・配送中', '',
      `repository ownerの承認を検証し、plan revision \`${state.revision}\` をChild Task Dispatcherへ投影しました。`],
  };
  const orderedState = {
    version: state.version, state: state.state, revision: state.revision,
    handledOwnerCommentId: state.handledOwnerCommentId,
    sourceOwnerCommentId: state.sourceOwnerCommentId,
    sourceSha256: state.sourceSha256, planSha256: state.planSha256,
    planCommentId: state.planCommentId, resultCommentId: state.resultCommentId,
    approvalCommentId: state.approvalCommentId, dispatchCommentId: state.dispatchCommentId,
  };
  return [...messages[state.state], '', `${STATE_PREFIX}${JSON.stringify(orderedState)} -->`].join('\n');
}

function commentsIncludingPayload(listed, payloadComment) {
  return listed.some((comment) => comment.id === payloadComment.id) ? listed : [...listed, payloadComment];
}

async function listAllComments(github, owner, repo, issueNumber) {
  return github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: issueNumber, per_page: 100 });
}

async function getIssue(github, owner, repo, issueNumber) {
  const response = await github.rest.issues.get({ owner, repo, issue_number: issueNumber });
  return response.data;
}

async function ensureLabels(github, owner, repo) {
  for (const spec of LABEL_SPECS) {
    try { await github.rest.issues.getLabel({ owner, repo, name: spec.name }); }
    catch (error) {
      if (error.status !== 404) throw error;
      await github.rest.issues.createLabel({ owner, repo, ...spec });
    }
  }
}

async function deleteLegacyCommandLabels(github, owner, repo) {
  for (const name of LEGACY_COMMAND_LABELS) {
    try { await github.rest.issues.deleteLabel({ owner, repo, name }); }
    catch (error) { if (error.status !== 404) throw error; }
  }
}

async function replaceStateLabel(github, owner, repo, issueNumber, nextState) {
  const issue = await getIssue(github, owner, repo, issueNumber);
  const currentLabels = new Set((issue.labels || []).map((label) => typeof label === 'string' ? label : label.name));
  for (const label of STATE_LABELS) {
    if (label === nextState || !currentLabels.has(label)) continue;
    try { await github.rest.issues.removeLabel({ owner, repo, issue_number: issueNumber, name: label }); }
    catch (error) { if (error.status !== 404) throw error; }
  }
  if (!currentLabels.has(nextState)) await github.rest.issues.addLabels({ owner, repo, issue_number: issueNumber, labels: [nextState] });
}

async function synchronizeIssueState(github, owner, repo, issueNumber, nextState) {
  if (!STATE_LABELS.includes(nextState)) throw new Error(`未知のCodex state labelです: ${nextState}`);
  await ensureLabels(github, owner, repo);
  await replaceStateLabel(github, owner, repo, issueNumber, nextState);
}

async function upsertAuthoritativeState({ github, owner, repo, issueNumber, comments, state, core }) {
  validateAuthoritativeState(state);
  const existing = comments.filter(isTrustedActionsComment).filter((comment) => authoritativeStateMarker(comment.body))
    .sort(byCreatedAtAndId).at(-1);
  const body = stateBody(state);
  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    if (core) core.info('Actions authoritative state commentを更新しました。');
    return { outcome: 'updated', commentId: existing.id };
  }
  const response = await github.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
  if (core) core.info('Actions authoritative state commentを作成しました。');
  return { outcome: 'created', commentId: response.data.id };
}

function freshEventComment(comments, eventComment, predicate) {
  const fresh = comments.find((comment) => comment.id === eventComment.id);
  return fresh && predicate(fresh) && normalizeText(fresh.body) === normalizeText(eventComment.body)
    && byCreatedAtAndId(fresh, eventComment) === 0 ? fresh : null;
}

function computeDispatchId(parentRepository, parentIssueNumber, taskKey, revision) {
  return `${parentRepository}#${parentIssueNumber}:${taskKey}:r${revision}`;
}

function expectedParentIssueUrl(repository, issueNumber) {
  return `https://github.com/${repository}/issues/${issueNumber}`;
}

function projectCandidate(candidate, state, issueNumber) {
  return {
    version: 1, key: candidate.key, title: candidate.title, repository: candidate.repository,
    parentIssue: { repository: PARENT_REPOSITORY, number: issueNumber,
      url: expectedParentIssueUrl(PARENT_REPOSITORY, issueNumber) },
    approvedPlan: { revision: state.revision, sha256: state.planSha256,
      sourceSha256: state.sourceSha256, sourceOwnerCommentId: state.sourceOwnerCommentId },
    priority: candidate.priority, agentStrategy: candidate.agentStrategy, work: candidate.work,
    outOfScope: candidate.outOfScope, completion: candidate.completion,
    dependencies: candidate.dependencies, concerns: candidate.concerns,
    verification: candidate.verification, cloudPublish: 'commit-and-web-ui-pr',
    documentation: candidate.documentation,
    dispatchId: computeDispatchId(PARENT_REPOSITORY, issueNumber, candidate.key, state.revision),
  };
}

function dispatchBlock(task) {
  const safeTitle = renderVisibleText(task.title);
  const json = stringifyMachineJson(task);
  return ['<!-- codex-task-dispatch:v1', json, '-->',
    `## ${task.key}: ${safeTitle}`, '', `対象repository: \`${task.repository}\``,
    '<!-- /codex-task-dispatch:v1 -->'].join('\n');
}

function buildDispatchBody(tasks, marker) {
  return [...tasks.map(dispatchBlock), `${DISPATCH_PREFIX}${JSON.stringify(marker)} -->`].join('\n\n');
}

function samePlanIdentity(left, right) {
  return left.revision === right.revision && left.sourceOwnerCommentId === right.sourceOwnerCommentId
    && left.sourceSha256 === right.sourceSha256 && left.planSha256 === right.planSha256
    && left.planCommentId === right.planCommentId;
}

async function recordApprovalRejection({ github, context, comments, reason, core }) {
  const { owner, repo } = context.repo;
  const approvalId = context.payload.comment.id;
  const marker = `${APPROVAL_RESULT_PREFIX}${JSON.stringify({ version: 1, approvalCommentId: approvalId, outcome: 'rejected' })} -->`;
  const existing = comments.find((comment) => isTrustedActionsComment(comment) && normalizeText(comment.body).endsWith(marker));
  const body = ['## 承認を受理できませんでした', '', reason, '',
    '最新のActions管理planを確認し、必要なら完全一致の `/codex approve` を再投稿してください。', '', marker].join('\n');
  if (existing) await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
  else await github.rest.issues.createComment({ owner, repo, issue_number: context.payload.issue.number, body });
  if (core) core.warning(reason);
}

async function handleApproval({ github, context, core }) {
  const payload = context.payload;
  if (isIssueCommentOnPullRequest(payload)) return core.info('Pull Requestコメントは親Issue承認として扱いません。');
  const repositoryOwner = payload.repository && payload.repository.owner;
  if (!isTrustedOwnerApproval(payload.comment, repositoryOwner)) return core.info('repository ownerのexact approvalではないため無視します。');
  const { owner, repo } = context.repo;
  const issueNumber = payload.issue.number;
  const comments = commentsIncludingPayload(await listAllComments(github, owner, repo, issueNumber), payload.comment);
  const approval = freshEventComment(comments, payload.comment, (comment) => isTrustedOwnerApproval(comment, repositoryOwner));
  const latestControl = latestOwnerControlComment(comments, repositoryOwner);
  const latestOwner = latestRepositoryOwnerComment(comments, repositoryOwner);
  if (!approval || !latestControl || latestControl.id !== approval.id || !latestOwner || latestOwner.id !== approval.id) {
    return recordApprovalRejection({ github, context, comments, reason: 'この承認より新しいowner control commentがあるため、古い承認は処理しません。', core });
  }
  const authoritative = latestAuthoritativeState(comments);
  if (!authoritative || !['awaiting-approval', 'approval-verified', 'approved'].includes(authoritative.state.state)) {
    return recordApprovalRejection({ github, context, comments, reason: '承認可能なActions管理planがありません。', core });
  }
  const current = authoritative.state;
  if (['approval-verified', 'approved'].includes(current.state)
      && current.approvalCommentId !== approval.id) {
    return recordApprovalRejection({ github, context, comments, reason: '別のowner承認ですでに処理済みです。', core });
  }
  const planComment = comments.find((comment) => comment.id === current.planCommentId);
  const sourceCommand = comments.find((comment) => comment.id === current.sourceOwnerCommentId);
  if (!isTrustedCodexComment(planComment) || !isTrustedOwnerCommand(sourceCommand, repositoryOwner)
      || byCreatedAtAndId(sourceCommand, planComment) >= 0 || byCreatedAtAndId(planComment, approval) >= 0) {
    return recordApprovalRejection({ github, context, comments, reason: 'plan、source command、approvalの時系列またはauthorを検証できません。', core });
  }
  const interveningOwnerComment = comments.find((comment) => isRepositoryOwnerComment(comment, repositoryOwner)
    && !isTrustedOwnerApproval(comment, repositoryOwner)
    && byCreatedAtAndId(sourceCommand, comment) < 0 && byCreatedAtAndId(comment, approval) < 0);
  if (interveningOwnerComment) {
    return recordApprovalRejection({ github, context, comments,
      reason: 'source command後に別のowner commentがあるため、要件変更として再計画が必要です。', core });
  }
  let semantic;
  try { semantic = parseSemanticResult(planComment.body); }
  catch { return recordApprovalRejection({ github, context, comments, reason: '承認対象planのcandidate schemaを検証できません。', core }); }
  if (!semantic || !['plan', 'revise'].includes(semantic.type) || planHash(planComment.body) !== current.planSha256) {
    return recordApprovalRejection({ github, context, comments, reason: '承認対象planが改変されているか、意味結果が不正です。', core });
  }
  const issue = await getIssue(github, owner, repo, issueNumber);
  const computedSourceHash = sourceHash({ repository: payload.repository.full_name || `${owner}/${repo}`,
    issue, comments, repositoryOwner, sourceOwnerCommentId: current.sourceOwnerCommentId });
  if (computedSourceHash !== current.sourceSha256) {
    return recordApprovalRejection({ github, context, comments, reason: '計画後にIssue要件またはsource境界が変更されたため、再計画が必要です。', core });
  }

  if (current.state === 'awaiting-approval') {
    const approvalVerified = { ...current, state: 'approval-verified',
      handledOwnerCommentId: approval.id, approvalCommentId: approval.id, dispatchCommentId: null };
    await upsertAuthoritativeState({ github, owner, repo, issueNumber, comments,
      state: approvalVerified, core });
    await replaceStateLabel(github, owner, repo, issueNumber, 'Codex:処理中');
  }

  const marker = { version: 1, revision: current.revision, approvalCommentId: approval.id,
    sourceOwnerCommentId: current.sourceOwnerCommentId, sourceSha256: current.sourceSha256,
    planSha256: current.planSha256, planCommentId: current.planCommentId };
  let dispatch = comments.filter(isTrustedActionsComment).find((comment) => {
    const candidate = dispatchMarker(comment.body);
    return candidate && canonicalJson(candidate) === canonicalJson(marker);
  });
  if (!dispatch) {
    const tasks = semantic.candidates.map((candidate) => projectCandidate(candidate, current, issueNumber));
    const response = await github.rest.issues.createComment({ owner, repo, issue_number: issueNumber,
      body: buildDispatchBody(tasks, marker) });
    dispatch = response.data;
  }
  const approved = { ...current, state: 'approved', handledOwnerCommentId: approval.id,
    approvalCommentId: approval.id, dispatchCommentId: dispatch.id };
  await upsertAuthoritativeState({ github, owner, repo, issueNumber, comments, state: approved, core });
  await github.rest.actions.createWorkflowDispatch({ owner, repo,
    workflow_id: 'child-task-dispatcher.yml', ref: payload.repository.default_branch,
    inputs: { issue_number: String(issueNumber), dispatch_comment_id: String(dispatch.id) } });
  if (core) core.info('ownerのexact approvalを検証し、承認済みplanをDispatcherへ投影しました。');
}

async function handleSemanticResult({ github, context, core }) {
  const payload = context.payload;
  if (isIssueCommentOnPullRequest(payload)) return core.info('Pull Requestコメントは親Issue control planeではないため対象外です。');
  if (!isTrustedCodexComment(payload.comment)) return core.info('信頼するCodex bot以外のsemantic resultは無視します。');
  let semantic;
  let semanticValidationFailed = false;
  try { semantic = parseSemanticResult(payload.comment.body); }
  catch (error) {
    if (!terminalSemanticResultMarker(payload.comment.body)) return core.warning('Codex semantic result markerを検証できないため無視します。');
    semantic = { type: 'error', candidates: [] };
    semanticValidationFailed = true;
    if (core) core.warning(`Codex semantic result schemaを検証できません: ${error.message}`);
  }
  if (!semantic) return core.info('Codex semantic result markerがないため対象外です。');

  const repositoryOwner = payload.repository && payload.repository.owner;
  const { owner, repo } = context.repo;
  const issueNumber = payload.issue.number;
  const comments = commentsIncludingPayload(await listAllComments(github, owner, repo, issueNumber), payload.comment);
  const result = freshEventComment(comments, payload.comment, isTrustedCodexComment);
  const sourceCommand = latestTrustedOwnerCommand(comments.filter((comment) => byCreatedAtAndId(comment, payload.comment) < 0), repositoryOwner);
  const latestCommand = latestTrustedOwnerCommand(comments, repositoryOwner);
  if (!result || !sourceCommand || !latestCommand || latestCommand.id !== sourceCommand.id) {
    return core.warning('最新のowner @codex commandへ対応するfresh semantic resultではないため無視します。');
  }
  const interveningOwnerComment = comments.find((comment) => isRepositoryOwnerComment(comment, repositoryOwner)
    && byCreatedAtAndId(sourceCommand, comment) < 0 && byCreatedAtAndId(comment, result) < 0);
  if (interveningOwnerComment) {
    return core.warning('source owner command後に別のowner commentがあるためsemantic resultを受理しません。');
  }
  const latestSemantic = latestComment(comments.filter((comment) => byCreatedAtAndId(sourceCommand, comment) < 0),
    (comment) => isTrustedCodexComment(comment) && terminalSemanticResultMarker(comment.body));
  if (!latestSemantic || latestSemantic.id !== result.id) return core.info('同じowner commandの最新semantic resultではないため無視します。');

  const issue = await getIssue(github, owner, repo, issueNumber);
  const computedSourceHash = sourceHash({ repository: payload.repository.full_name || `${owner}/${repo}`,
    issue, comments, repositoryOwner, sourceOwnerCommentId: sourceCommand.id });
  const previous = latestAuthoritativeState(comments);
  const resultPlanHash = ['plan', 'revise'].includes(semantic.type) ? planHash(result.body) : null;
  if (previous && previous.state.sourceOwnerCommentId === sourceCommand.id) {
    const exactRerun = previous.state.resultCommentId === result.id;
    const equivalentPlanRerun = resultPlanHash && previous.state.planSha256 === resultPlanHash
      && ['awaiting-approval', 'approval-verified', 'approved'].includes(previous.state.state);
    if (exactRerun || equivalentPlanRerun) {
      const repairLabel = { 'awaiting-approval': 'Codex:承認待ち', question: 'Codex:回答待ち',
        error: 'Codex:要判断' }[previous.state.state];
      if (repairLabel) await synchronizeIssueState(github, owner, repo, issueNumber, repairLabel);
      return core.info('同じowner commentのsemantic resultは処理済みのためrevisionを増やしません。');
    }
    return core.warning('同じowner commentから競合するsemantic resultが生成されたためauthoritative stateを上書きしません。');
  }
  const previousRevision = previous ? previous.state.revision : 0;
  const isPlan = ['plan', 'revise'].includes(semantic.type);
  const state = { version: 1, state: isPlan ? 'awaiting-approval' : semantic.type,
    revision: isPlan ? previousRevision + 1 : previousRevision,
    handledOwnerCommentId: sourceCommand.id, sourceOwnerCommentId: sourceCommand.id,
    sourceSha256: computedSourceHash, planSha256: resultPlanHash,
    planCommentId: isPlan ? result.id : null, resultCommentId: result.id,
    approvalCommentId: null, dispatchCommentId: null };
  await upsertAuthoritativeState({ github, owner, repo, issueNumber, comments, state, core });
  const nextLabel = isPlan ? 'Codex:承認待ち' : semantic.type === 'question' ? 'Codex:回答待ち' : 'Codex:要判断';
  await replaceStateLabel(github, owner, repo, issueNumber, nextLabel);
  if (semanticValidationFailed && core) core.info('不正なsemantic resultをActions管理error stateとして記録しました。');
}

async function handleOwnerPlanCommand({ github, context, core }) {
  const payload = context.payload;
  if (isIssueCommentOnPullRequest(payload)) return core.info('Pull Requestコメントは親Issue control planeではないため対象外です。');
  const repositoryOwner = payload.repository && payload.repository.owner;
  if (!isTrustedOwnerCommand(payload.comment, repositoryOwner)) return core.info('repository ownerの@codex付きコメントではないため状態を変更しません。');
  const { owner, repo } = context.repo;
  const comments = commentsIncludingPayload(await listAllComments(github, owner, repo, payload.issue.number), payload.comment);
  const latest = latestTrustedOwnerCommand(comments, repositoryOwner);
  if (!latest || latest.id !== payload.comment.id) return core.info('より新しいowner @codex commandがあるため古いrunを無視します。');
  await synchronizeIssueState(github, owner, repo, payload.issue.number, 'Codex:処理中');
}

async function handleLabelMigration({ github, context, core }) {
  const { owner, repo } = context.repo;
  await ensureLabels(github, owner, repo);
  await deleteLegacyCommandLabels(github, owner, repo);
  core.info('status labelを確認し、旧コマンドラベルを削除しました。');
}

async function run({ github, context, core }) {
  if (context.eventName === 'push') return handleLabelMigration({ github, context, core });
  if (context.eventName !== 'issue_comment' || context.payload.action !== 'created') return core.info('対象イベントではないため終了します。');
  if (!context.payload.repository || context.payload.repository.full_name !== PARENT_REPOSITORY) {
    return core.info('親matsu-workspace repository以外のIssue commentは対象外です。');
  }
  if (isExactApprovalCommand(context.payload.comment && context.payload.comment.body)) return handleApproval({ github, context, core });
  if (isTrustedCodexComment(context.payload.comment)) return handleSemanticResult({ github, context, core });
  return handleOwnerPlanCommand({ github, context, core });
}

module.exports = {
  ACTIONS_BOT, AGENT_STRATEGIES, ALLOWED_REPOSITORIES, CODEX_BOT, LABEL_SPECS,
  LEGACY_COMMAND_LABELS, PARENT_REPOSITORY, STATE_LABELS, authoritativeStateMarker,
  buildDispatchBody, byCreatedAtAndId, canonicalJson, compareOrdinal, computeDispatchId,
  containsCodexMention, dispatchMarker, isExactApprovalCommand, isOwnerControlComment,
  isRepositoryOwnerComment, isTrustedActionsComment, isTrustedCodexComment,
  isTrustedOwnerApproval, isTrustedOwnerCommand, latestAuthoritativeState,
  latestOwnerControlComment, latestRepositoryOwnerComment, latestTrustedOwnerCommand, parsePlanCandidates,
  parseSemanticResult, planHash, projectCandidate, renderCandidateHuman, renderVisibleText, run,
  semanticResultMarker, sourceHash, stateBody, stringifyMachineJson, synchronizeIssueState,
  validateAuthoritativeState, validateCandidateTask,
};
