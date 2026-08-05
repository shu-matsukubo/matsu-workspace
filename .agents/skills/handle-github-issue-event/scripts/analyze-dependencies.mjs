#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { canonicalJson, compareOrdinal } from './hash-issue-state.mjs';

const TYPES = new Set(['hard', 'soft', 'ordering']);
const GATES = new Set(['start', 'complete', 'publish', 'merge']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function isComplete(node) {
  if (node.kind === 'pull-request') {
    return node.state === 'merged';
  }
  if (node.kind === 'issue') {
    return node.state === 'closed'
      && node.artifactsComplete === true
      && node.relatedPullRequestsComplete === true;
  }
  if (node.kind === 'task') {
    return node.state === 'completed'
      && node.resultsRecorded === true
      && node.verificationRecorded === true
      && node.branchPullRequestConsistent === true;
  }
  if (node.kind === 'child-change' || node.kind === 'parent-gitlink') {
    return node.state === 'merged';
  }
  return node.kind === 'derived' && node.complete === true;
}

export function normalizeGraph(input) {
  assert(input && Array.isArray(input.nodes), 'nodesは配列で指定してください。');
  assert(Array.isArray(input.edges), 'edgesは配列で指定してください。');

  const ids = new Set();
  const nodes = input.nodes.map((node) => {
    assert(node && typeof node.id === 'string' && node.id.length > 0, 'node.idは空でない文字列にしてください。');
    assert(!ids.has(node.id), `node.idが重複しています: ${node.id}`);
    ids.add(node.id);
    return { ...node, complete: isComplete(node) };
  }).sort((a, b) => compareOrdinal(a.id, b.id));

  const edges = input.edges.map((edge, index) => {
    assert(edge && ids.has(edge.from), `edge[${index}].fromが未定義です: ${edge && edge.from}`);
    assert(ids.has(edge.to), `edge[${index}].toが未定義です: ${edge && edge.to}`);
    assert(TYPES.has(edge.type), `edge[${index}].typeが不正です: ${edge.type}`);
    assert(GATES.has(edge.gate), `edge[${index}].gateが不正です: ${edge.gate}`);
    assert(edge.type !== 'ordering' || edge.gate === 'publish' || edge.gate === 'merge',
      `edge[${index}]のordering dependencyはpublishまたはmerge gateだけを指定できます。`);
    assert(typeof edge.completion === 'string' && edge.completion.length > 0, `edge[${index}].completionを指定してください。`);
    assert(typeof edge.evidence === 'string' && edge.evidence.length > 0, `edge[${index}].evidenceを指定してください。`);
    return {
      from: edge.from,
      to: edge.to,
      type: edge.type,
      gate: edge.gate,
      completion: edge.completion,
      evidence: edge.evidence,
    };
  }).sort((a, b) => compareOrdinal(canonicalJson(a), canonicalJson(b)));

  return { nodes, edges };
}

function canonicalCycle(nodeIds) {
  const body = nodeIds.slice(0, -1);
  if (body.length === 1) return `${body[0]}->${body[0]}`;
  const rotations = body.map((_, index) => body.slice(index).concat(body.slice(0, index)));
  rotations.sort((a, b) => compareOrdinal(a.join('\u0000'), b.join('\u0000')));
  return `${rotations[0].join('->')}->${rotations[0][0]}`;
}

function findCycles(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) adjacency.get(edge.from).push(edge);
  for (const list of adjacency.values()) list.sort((a, b) => compareOrdinal(canonicalJson(a), canonicalJson(b)));

  const found = new Map();

  function walk(start, current, pathNodes, pathEdges, visited) {
    for (const edge of adjacency.get(current)) {
      if (edge.to === start) {
        const nodesInCycle = [...pathNodes, start];
        const edgesInCycle = [...pathEdges, edge];
        const key = canonicalCycle(nodesInCycle);
        if (!found.has(key)) {
          found.set(key, {
            path: nodesInCycle,
            edges: edgesInCycle.map(({ from, to, type, gate, completion, evidence }) => ({
              from, to, type, gate, completion, evidence,
            })),
          });
        }
        continue;
      }
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      walk(start, edge.to, [...pathNodes, edge.to], [...pathEdges, edge], visited);
      visited.delete(edge.to);
    }
  }

  for (const node of nodes) walk(node.id, node.id, [node.id], [], new Set([node.id]));
  return [...found.values()].sort((a, b) => compareOrdinal(a.path.join('->'), b.path.join('->')));
}

function blocksAt(edge, gate) {
  if (edge.type === 'soft') return false;
  if (edge.type === 'hard') {
    const order = ['start', 'complete', 'publish', 'merge'];
    return order.indexOf(gate) >= order.indexOf(edge.gate);
  }
  return edge.type === 'ordering' && (gate === edge.gate || (edge.gate === 'publish' && gate === 'merge'));
}

export function analyzeDependencies(input, gate = 'start') {
  assert(GATES.has(gate), `評価gateが不正です: ${gate}`);
  const graph = normalizeGraph(input);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const unresolvedEdges = graph.edges.filter((edge) => !nodesById.get(edge.to).complete);
  const activeEdges = unresolvedEdges.filter((edge) => blocksAt(edge, gate));
  const blockersByNode = Object.fromEntries(graph.nodes.map((node) => [node.id, []]));
  for (const { from, to, type, gate: edgeGate, completion, evidence } of activeEdges) {
    blockersByNode[from].push({ from, to, type, gate: edgeGate, completion, evidence });
  }
  const readyNodes = graph.nodes
    .filter((node) => blockersByNode[node.id].length === 0)
    .map((node) => node.id);

  return {
    gate,
    nodes: graph.nodes,
    edges: graph.edges,
    cycles: findCycles(graph.nodes, unresolvedEdges),
    blockingCycles: findCycles(graph.nodes, activeEdges),
    blockersByNode,
    readyNodes,
    blockers: activeEdges.map(({ from, to, type, gate: edgeGate, completion, evidence }) => ({
      from, to, type, gate: edgeGate, completion, evidence,
    })),
    allReady: activeEdges.length === 0,
  };
}

async function readInput(file) {
  if (file) return fs.readFileSync(file, 'utf8');
  let content = '';
  for await (const chunk of process.stdin) content += chunk;
  return content;
}

async function main() {
  const args = process.argv.slice(2);
  const gateIndex = args.indexOf('--gate');
  const gate = gateIndex >= 0 ? args[gateIndex + 1] : 'start';
  const file = args.find((arg, index) => arg !== '--gate' && index !== gateIndex + 1);
  const input = JSON.parse(await readInput(file));
  process.stdout.write(`${JSON.stringify(analyzeDependencies(input, gate), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
