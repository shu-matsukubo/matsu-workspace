#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const CONTROL_LABELS = new Set([
  'Codex:回答済', 'Codex:差し戻し', 'Codex:承認',
  'Codex:処理中', 'Codex:回答待ち', 'Codex:承認待ち',
  'Codex:依存待ち', 'Codex:要判断', 'Codex:PR作成済',
]);

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
  const labels = (input.labels || [])
    .map((label) => typeof label === 'string' ? label : label.name)
    .map(normalizeText)
    .filter((label) => !CONTROL_LABELS.has(label))
    .sort(compareOrdinal);
  const ownerComments = (input.ownerComments || [])
    .map((comment) => ({
      id: Number(comment.id),
      authorId: Number(comment.authorId),
      createdAt: normalizeText(comment.createdAt),
      body: normalizeText(comment.body),
    }))
    .sort((a, b) => compareOrdinal(a.createdAt, b.createdAt) || a.id - b.id);
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
