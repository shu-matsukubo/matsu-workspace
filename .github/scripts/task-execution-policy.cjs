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

const TASK_ENTRY_KINDS = Object.freeze([
  'parent-issue',
  'child-issue',
  'direct',
]);

const ISSUE_HANDLER_INTENTS = Object.freeze([
  'plan',
  'answer',
  'revise',
  'dispatch',
  'review-fix',
  'unknown',
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

function taskGateResult(overrides) {
  return Object.freeze({
    intent: null,
    resultMarkerState: null,
    allowsImplementation: false,
    allowsDispatch: false,
    allowsDependencyInstall: false,
    allowsImplementationQualityGates: false,
    requiresIssueHandler: false,
    requiresValidatedExecutionPacket: false,
    requiresResultMarker: false,
    requiresReplanForNewDependency: false,
    humanOutputLanguage: 'ja',
    ...overrides,
  });
}

function resolveTaskExecutionGate({
  runtime,
  entryKind = 'direct',
  parent = {},
  child = {},
  approvedScope = {},
} = {}) {
  if (!TASK_ENTRY_KINDS.includes(entryKind)) {
    throw new TypeError(`未対応のtask entry kindです: ${entryKind}`);
  }
  const executionContext = resolveExecutionContext(runtime);
  const dependencyChangeApproved = approvedScope
    && approvedScope.dependencyChange === true;

  if (executionContext === 'local-direct') {
    return taskGateResult({
      executionContext,
      entryKind: 'direct',
      nextAction: 'implement',
      allowsImplementation: true,
      allowsDependencyInstall: true,
      allowsImplementationQualityGates: true,
      dependencyAction: 'use-existing-local-flow',
    });
  }

  if (executionContext === 'cloud-direct'
      || (executionContext === 'unknown' && entryKind === 'direct')) {
    return taskGateResult({
      executionContext,
      entryKind: 'direct',
      nextAction: 'implement',
      allowsImplementation: true,
      allowsDependencyInstall: executionContext === 'cloud-direct' && dependencyChangeApproved,
      allowsImplementationQualityGates: true,
      requiresReplanForNewDependency: executionContext === 'cloud-direct'
        && !dependencyChangeApproved,
      dependencyAction: executionContext === 'cloud-direct' && dependencyChangeApproved
        ? 'install-approved-dependency-change'
        : 'use-existing-dependencies',
    });
  }

  if (executionContext !== 'issue-cloud') {
    return taskGateResult({
      executionContext,
      entryKind,
      nextAction: 'reject-unverified-issue-entry',
      requiresIssueHandler: true,
      requiresValidatedExecutionPacket: true,
      requiresReplanForNewDependency: true,
      dependencyAction: 'prohibited-in-unverified-issue-entry',
    });
  }

  if (entryKind === 'parent-issue') {
    const handlerEvaluated = parent && parent.handlerEvaluated === true;
    const hasValidPlan = parent && parent.hasValidPlan === true;
    const planApproved = parent && parent.planApproved === true;
    const handlerIntent = ISSUE_HANDLER_INTENTS.includes(parent && parent.handlerIntent)
      ? parent.handlerIntent
      : 'unknown';
    let intent = handlerIntent;
    let nextAction = `handle-${handlerIntent}`;
    let resultMarkerState = null;
    let allowsDispatch = false;

    if (!handlerEvaluated) {
      intent = null;
      nextAction = 'handle-github-issue-event';
    } else if (!hasValidPlan) {
      intent = 'plan';
      nextAction = 'plan';
      resultMarkerState = 'plan';
    } else if (handlerIntent === 'dispatch' && planApproved) {
      nextAction = 'dispatch';
      resultMarkerState = 'tasks-dispatched';
      allowsDispatch = true;
    } else if (handlerIntent === 'dispatch') {
      intent = 'unknown';
      nextAction = 'await-explicit-approval';
      resultMarkerState = 'question';
    } else if (handlerIntent === 'review-fix') {
      nextAction = 'route-review-fix-to-child-task';
      resultMarkerState = 'question';
    } else if (handlerIntent === 'unknown') {
      resultMarkerState = 'question';
    } else if (handlerIntent === 'plan') {
      resultMarkerState = 'plan';
    }

    return taskGateResult({
      executionContext,
      entryKind,
      intent,
      nextAction,
      resultMarkerState,
      allowsDispatch,
      requiresIssueHandler: true,
      requiresResultMarker: true,
      requiresReplanForNewDependency: true,
      dependencyAction: 'prohibited-in-parent-issue-cloud',
    });
  }

  if (entryKind === 'child-issue') {
    const packetVerified = child && child.executionPacketVerified === true;
    return taskGateResult({
      executionContext,
      entryKind,
      nextAction: packetVerified ? 'implement' : 'verify-child-execution-packet',
      allowsImplementation: packetVerified,
      allowsDependencyInstall: packetVerified && dependencyChangeApproved,
      allowsImplementationQualityGates: packetVerified,
      requiresValidatedExecutionPacket: true,
      requiresReplanForNewDependency: !dependencyChangeApproved,
      dependencyAction: !packetVerified
        ? 'verify-child-execution-packet'
        : dependencyChangeApproved
          ? 'install-approved-dependency-change'
          : 'use-preinstalled-dependencies',
    });
  }

  return taskGateResult({
    executionContext,
    entryKind,
    nextAction: 'reject-unverified-issue-entry',
    requiresIssueHandler: true,
    requiresValidatedExecutionPacket: true,
    requiresReplanForNewDependency: true,
    dependencyAction: 'prohibited-in-unverified-issue-entry',
  });
}

module.exports = {
  APPROVAL_SCOPE_FIELDS,
  BOOKKEEPING_FIELDS,
  EXECUTION_CONTEXTS,
  ISSUE_HANDLER_INTENTS,
  PUBLICATION_MODES,
  TASK_ENTRY_KINDS,
  assessTaskChanges,
  resolveExecutionContext,
  resolveExecutionPolicy,
  resolvePublicationMode,
  resolveTaskExecutionGate,
};
