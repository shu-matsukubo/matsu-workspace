'use strict';

const EXECUTION_CONTEXTS = Object.freeze([
  'issue-cloud',
  'cloud-direct',
  'local-direct',
  'unknown',
]);

const PUBLICATION_MODES = Object.freeze([
  'codex-web-ui',
  'github-connector',
  'local-git-fallback',
  'remote-stopped',
]);

const BOOKKEEPING_FIELDS = Object.freeze([
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

const APPROVAL_SCOPE_FIELDS = Object.freeze([
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
]);

const BOOKKEEPING_FIELD_SET = new Set(BOOKKEEPING_FIELDS);
const APPROVAL_SCOPE_FIELD_SET = new Set(APPROVAL_SCOPE_FIELDS);

function assessTaskChanges(changedFields) {
  if (!Array.isArray(changedFields)) {
    throw new TypeError('changedFieldsは配列である必要があります。');
  }

  const bookkeeping = [];
  const scopeChanges = [];
  const unknown = [];
  for (const field of changedFields) {
    if (typeof field !== 'string' || !field) {
      throw new TypeError('changedFieldsには空でない文字列だけを指定してください。');
    }
    if (BOOKKEEPING_FIELD_SET.has(field)) bookkeeping.push(field);
    else if (APPROVAL_SCOPE_FIELD_SET.has(field)) scopeChanges.push(field);
    else unknown.push(field);
  }

  return Object.freeze({
    bookkeeping: Object.freeze(bookkeeping),
    scopeChanges: Object.freeze(scopeChanges),
    unknown: Object.freeze(unknown),
    requiresReapproval: scopeChanges.length > 0 || unknown.length > 0,
  });
}

function resolveExecutionContext(runtime = {}) {
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) return 'unknown';
  if (runtime.context === 'issue-cloud' && runtime.source === 'trusted-issue-event') {
    return 'issue-cloud';
  }
  if ((runtime.context === 'cloud-direct' || runtime.context === 'local-direct')
      && runtime.source === 'trusted-runtime-metadata') {
    return runtime.context;
  }
  return 'unknown';
}

function resolvePublicationMode(executionContext, capabilities = {}) {
  if (executionContext === 'issue-cloud' || executionContext === 'cloud-direct') {
    return Object.freeze({
      mode: 'codex-web-ui',
      action: 'delegate-to-codex-web-ui',
      allowsRemoteWrite: false,
    });
  }
  if (executionContext === 'unknown') {
    return Object.freeze({
      mode: 'remote-stopped',
      action: 'stop-remote-publication',
      allowsRemoteWrite: false,
    });
  }
  if (executionContext !== 'local-direct') {
    throw new TypeError(`未対応のexecution contextです: ${executionContext}`);
  }

  if (capabilities && capabilities.githubConnectorWrite === true) {
    return Object.freeze({
      mode: 'github-connector',
      action: 'publish-draft-pr',
      allowsRemoteWrite: true,
    });
  }
  if (capabilities
      && capabilities.localGitPush === true
      && capabilities.githubPullRequestWrite === true) {
    return Object.freeze({
      mode: 'local-git-fallback',
      action: 'publish-draft-pr',
      allowsRemoteWrite: true,
    });
  }
  return Object.freeze({
    mode: 'remote-stopped',
    action: 'stop-remote-publication',
    allowsRemoteWrite: false,
  });
}

function resolveExecutionPolicy({ runtime, capabilities } = {}) {
  const executionContext = resolveExecutionContext(runtime);
  const publication = resolvePublicationMode(executionContext, capabilities);
  return Object.freeze({ executionContext, ...publication });
}

module.exports = {
  APPROVAL_SCOPE_FIELDS,
  BOOKKEEPING_FIELDS,
  EXECUTION_CONTEXTS,
  PUBLICATION_MODES,
  assessTaskChanges,
  resolveExecutionContext,
  resolveExecutionPolicy,
  resolvePublicationMode,
};
