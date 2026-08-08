#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const LEGACY_COMMAND_LABELS = [
  'Codex:回答済', 'Codex:差し戻し', 'Codex:承認',
];

const STATE_LABELS = [
  'Codex:処理中', 'Codex:回答待ち', 'Codex:承認待ち',
  'Codex:依存待ち', 'Codex:要判断', 'Codex:PR作成済',
];

const CONTROL_LABELS = new Set([...LEGACY_COMMAND_LABELS, ...STATE_LABELS]);

const DEPENDENCY_FIELDS = [
  'id', 'kind', 'state', 'completion', 'headSha', 'mergeCommitSha', 'mergedAt', 'closedAt',
  'artifactsComplete', 'relatedPullRequestsComplete', 'resultsRecorded',
  'verificationRecorded', 'branchPullRequestConsistent', 'from', 'to', 'type', 'gate',
];

export function compareOrdinal(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').normalize('NFC');
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(compareOrdinal).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function dependencyProjection(item) {
  return Object.fromEntries(DEPENDENCY_FIELDS
    .filter((field) => item[field] !== undefined)
    .map((field) => [field, typeof item[field] === 'string' ? normalizeText(item[field]) : item[field]]));
}

export function canonicalSource(input) {
  if (!input || !input.issue) throw new Error('issueを指定してください。');
  const sourceOwnerCommentId = Number(input.sourceOwnerCommentId);
  if (!Number.isSafeInteger(sourceOwnerCommentId) || sourceOwnerCommentId < 1) {
    throw new Error('sourceOwnerCommentIdへ正の整数を指定してください。');
  }
  const labels = (input.labels || [])
    .map((label) => typeof label === 'string' ? label : label.name)
    .map(normalizeText)
    .filter((label) => !CONTROL_LABELS.has(label))
    .sort(compareOrdinal);
  const allOwnerComments = (input.ownerComments || [])
    .map((comment) => ({
      id: Number(comment.id),
      authorId: Number(comment.authorId),
      createdAt: normalizeText(comment.createdAt),
      body: normalizeText(comment.body),
    }))
    .sort((a, b) => compareOrdinal(a.createdAt, b.createdAt) || a.id - b.id);
  const boundaryIndexes = allOwnerComments
    .map((comment, index) => comment.id === sourceOwnerCommentId ? index : -1)
    .filter((index) => index >= 0);
  if (boundaryIndexes.length !== 1) {
    throw new Error('sourceOwnerCommentIdに一致するowner commentを一意に特定できません。');
  }
  const ownerComments = allOwnerComments.slice(0, boundaryIndexes[0] + 1);
  const dependencies = (input.dependencies || [])
    .map(dependencyProjection)
    .sort((a, b) => compareOrdinal(canonicalJson(a), canonicalJson(b)));

  return canonicalJson({
    issue: {
      repository: normalizeText(input.issue.repository),
      number: Number(input.issue.number),
      title: normalizeText(input.issue.title),
      body: normalizeText(input.issue.body),
    },
    sourceOwnerCommentId,
    labels,
    ownerComments,
    dependencies,
  });
}

export function sourceHash(input) {
  return crypto.createHash('sha256').update(canonicalSource(input), 'utf8').digest('hex');
}

export function normalizePlan(body) {
  return normalizeText(body)
    .split('\n')
    .filter((line) => !/^\s*<!-- codex-issue-flow state=.+ -->\s*$/.test(line))
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

export function planHash(body) {
  return crypto.createHash('sha256').update(normalizePlan(body), 'utf8').digest('hex');
}

async function readInput(file) {
  if (file) return fs.readFileSync(file, 'utf8');
  let content = '';
  for await (const chunk of process.stdin) content += chunk;
  return content;
}

async function main() {
  const [mode, file] = process.argv.slice(2);
  if (mode !== 'source' && mode !== 'plan') {
    throw new Error('usage: hash-issue-state.mjs <source|plan> [input-file]');
  }
  const input = await readInput(file);
  process.stdout.write(`${mode === 'source' ? sourceHash(JSON.parse(input)) : planHash(input)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
