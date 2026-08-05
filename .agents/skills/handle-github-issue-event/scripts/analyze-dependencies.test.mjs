import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeDependencies, isComplete } from './analyze-dependencies.mjs';

const current = (id, kind = 'issue', extra = {}) => ({ id, kind, state: 'open', ...extra });
const edge = (from, to, type = 'hard', gate = 'start') => ({
  from,
  to,
  type,
  gate,
  completion: `${to}の現在状態が完了条件を満たす`,
  evidence: `GitHubまたはtask fileから取得した${to}の現在状態`,
});

test('detects a self dependency', () => {
  const result = analyzeDependencies({ nodes: [current('Issue #1')], edges: [edge('Issue #1', 'Issue #1')] });
  assert.deepEqual(result.blockingCycles[0].path, ['Issue #1', 'Issue #1']);
  assert.equal(result.allReady, false);
});

test('detects direct and indirect cycles across Issue, PR, and task', () => {
  const nodes = [
    current('Issue #10'),
    current('PR #21', 'pull-request', { state: 'draft' }),
    current('Task C', 'task', { state: 'active' }),
  ];
  const edges = [edge('Issue #10', 'PR #21'), edge('PR #21', 'Task C'), edge('Task C', 'Issue #10')];
  const result = analyzeDependencies({ nodes, edges });
  assert.equal(result.cycles.length, 1);
  assert.deepEqual(result.cycles[0].path, ['Issue #10', 'PR #21', 'Task C', 'Issue #10']);
});

test('reports soft cycles without blocking implementation', () => {
  const nodes = [current('Issue A'), current('Issue B')];
  const result = analyzeDependencies({
    nodes,
    edges: [edge('Issue A', 'Issue B', 'soft'), edge('Issue B', 'Issue A', 'soft')],
  });
  assert.equal(result.cycles.length, 1);
  assert.equal(result.blockingCycles.length, 0);
  assert.equal(result.allReady, true);
});

test('ordering dependency blocks merge but not start', () => {
  const graph = {
    nodes: [current('Front PR', 'pull-request'), current('API PR', 'pull-request', { state: 'approved' })],
    edges: [edge('Front PR', 'API PR', 'ordering', 'merge')],
  };
  assert.equal(analyzeDependencies(graph, 'start').allReady, true);
  assert.equal(analyzeDependencies(graph, 'merge').allReady, false);
});

test('parent gitlink reverse dependency cycle is detected', () => {
  const nodes = [current('child PR', 'child-change'), current('parent lock PR', 'parent-gitlink')];
  const result = analyzeDependencies({
    nodes,
    edges: [edge('child PR', 'parent lock PR'), edge('parent lock PR', 'child PR')],
  });
  assert.equal(result.blockingCycles.length, 1);
});

test('merge condition and implementation condition cycle is detected', () => {
  const nodes = [current('implementation', 'task', { state: 'active' }), current('merge PR', 'pull-request')];
  const result = analyzeDependencies({
    nodes,
    edges: [edge('implementation', 'merge PR', 'hard', 'start'), edge('merge PR', 'implementation', 'hard', 'complete')],
  }, 'complete');
  assert.equal(result.blockingCycles.length, 1);
});

test('Pull Request completion distinguishes merged and closed without merge', () => {
  assert.equal(isComplete(current('draft', 'pull-request', { state: 'draft' })), false);
  assert.equal(isComplete(current('approved', 'pull-request', { state: 'approved' })), false);
  assert.equal(isComplete(current('merged', 'pull-request', { state: 'merged' })), true);
  assert.equal(isComplete(current('closed', 'pull-request', { state: 'closed-without-merge' })), false);
});

test('completed current target does not remain a blocker or false cycle edge', () => {
  const nodes = [
    current('Issue A'),
    current('PR B', 'pull-request', { state: 'merged' }),
  ];
  const result = analyzeDependencies({ nodes, edges: [edge('Issue A', 'PR B'), edge('PR B', 'Issue A')] });
  assert.equal(result.cycles.length, 0);
  assert.equal(result.blockers.length, 1);
});

test('reports readiness per node so an unrelated task can proceed', () => {
  const nodes = [current('Issue A'), current('PR B', 'pull-request'), current('Task C', 'task')];
  const result = analyzeDependencies({ nodes, edges: [edge('Issue A', 'PR B')] });
  assert.equal(result.allReady, false);
  assert.deepEqual(result.blockersByNode['Issue A'].map((item) => item.to), ['PR B']);
  assert.deepEqual(result.blockersByNode['Task C'], []);
  assert.ok(result.readyNodes.includes('Task C'));
});

test('known GitHub kinds cannot override current state with complete=true', () => {
  assert.equal(isComplete(current('closed', 'pull-request', {
    state: 'closed-without-merge', complete: true,
  })), false);
  assert.equal(isComplete(current('open issue', 'issue', {
    state: 'open', complete: true, artifactsComplete: true, relatedPullRequestsComplete: true,
  })), false);
  assert.equal(isComplete(current('derived', 'derived', { complete: true })), true);
});

test('Issue and task completion require recorded artifacts and consistency', () => {
  assert.equal(isComplete(current('I', 'issue', { state: 'closed' })), false);
  assert.equal(isComplete(current('I', 'issue', {
    state: 'closed', artifactsComplete: true, relatedPullRequestsComplete: true,
  })), true);
  assert.equal(isComplete(current('T', 'task', { state: 'completed' })), false);
  assert.equal(isComplete(current('T', 'task', {
    state: 'completed', resultsRecorded: true, verificationRecorded: true, branchPullRequestConsistent: true,
  })), true);
});

test('rejects incomplete edge evidence instead of guessing', () => {
  assert.throws(() => analyzeDependencies({
    nodes: [current('A'), current('B')],
    edges: [{ from: 'A', to: 'B', type: 'hard', gate: 'start' }],
  }), /completion/);
});

test('ordering dependency rejects start and complete gates', () => {
  for (const gate of ['start', 'complete']) {
    assert.throws(() => analyzeDependencies({
      nodes: [current('A'), current('B')],
      edges: [edge('A', 'B', 'ordering', gate)],
    }), /publishまたはmerge/);
  }
});

test('cycle and adjacency ordering do not depend on localeCompare', () => {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = () => { throw new Error('localeCompare must not be used'); };
  try {
    const result = analyzeDependencies({
      nodes: [current('Issue あ'), current('Issue Z'), current('Issue a')],
      edges: [edge('Issue あ', 'Issue Z'), edge('Issue Z', 'Issue あ'), edge('Issue a', 'Issue Z')],
    });
    assert.equal(result.cycles.length, 1);
  } finally {
    String.prototype.localeCompare = original;
  }
});

test('node and parallel edge input order does not change analysis output', () => {
  const graph = {
    nodes: [current('Issue A'), current('Issue B'), current('Task C', 'task')],
    edges: [
      edge('Issue A', 'Issue B', 'soft', 'complete'),
      edge('Issue A', 'Issue B', 'hard', 'start'),
      edge('Issue B', 'Issue A', 'hard', 'start'),
      edge('Task C', 'Issue B', 'soft', 'complete'),
    ],
  };
  const reversed = { nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() };
  assert.deepEqual(analyzeDependencies(graph), analyzeDependencies(reversed));
});
