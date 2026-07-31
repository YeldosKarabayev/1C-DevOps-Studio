'use strict';
const { run } = require('./exec');

const US = '\x1f'; // unit separator
const RS = '\x1e'; // record separator

function git(cwd, args, onData) {
  return run('git', args, { cwd, onData });
}

async function isRepo(cwd) {
  const r = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  return r.code === 0 && r.stdout.trim() === 'true';
}

async function currentBranch(cwd) {
  const r = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.stdout.trim();
}

async function branches(cwd) {
  const r = await git(cwd, ['branch', '--format=%(refname:short)']);
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

async function log(cwd, limit = 120) {
  const fmt = ['%H', '%h', '%an', '%ad', '%ar', '%s'].join(US) + RS;
  const r = await git(cwd, ['log', `--max-count=${limit}`, '--date=format:%Y-%m-%d %H:%M', `--pretty=format:${fmt}`]);
  if (r.code !== 0) return { error: r.stderr.trim(), commits: [] };
  const commits = r.stdout.split(RS).map((rec) => rec.trim()).filter(Boolean).map((rec) => {
    const [hash, short, author, date, rel, subject] = rec.split(US);
    return { hash, short, author, date, rel, subject };
  });
  return { commits };
}

async function logGraph(cwd, limit = 200) {
  const fmt = ['%H', '%h', '%P', '%an', '%ad', '%ar', '%D', '%s'].join(US) + RS;
  const r = await git(cwd, ['log', '--date-order', '--all', `--max-count=${limit}`,
    '--date=format:%Y-%m-%d %H:%M', `--pretty=format:${fmt}`]);
  if (r.code !== 0) return { error: r.stderr.trim(), commits: [] };
  const commits = r.stdout.split(RS).map((rec) => rec.trim()).filter(Boolean).map((rec) => {
    const [hash, short, parents, author, date, rel, refs, subject] = rec.split(US);
    return {
      hash, short,
      parents: parents ? parents.split(' ').filter(Boolean) : [],
      author, date, rel, subject,
      refs: refs ? refs.split(',').map((s) => s.trim()).filter(Boolean) : [],
    };
  });
  return { commits };
}

async function commitStat(cwd, hash) {
  const meta = await git(cwd, ['show', '-s', '--date=format:%Y-%m-%d %H:%M',
    `--pretty=format:%H${US}%h${US}%an${US}%ae${US}%ad${US}%P${US}%B`, hash]);
  const [full, short, author, email, date, parents, ...bodyParts] = meta.stdout.split(US);
  const body = bodyParts.join(US).trim();

  // numstat: add\tdel\tpath
  const ns = await git(cwd, ['show', '--numstat', '--format=', hash]);
  const stats = {};
  ns.stdout.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => {
    const m = l.split('\t');
    if (m.length >= 3) stats[m[2]] = { add: m[0] === '-' ? 0 : +m[0], del: m[1] === '-' ? 0 : +m[1] };
  });
  // name-status: X\tpath
  const nsFiles = await git(cwd, ['show', '--name-status', '--format=', hash]);
  const files = nsFiles.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.split('\t');
    const file = m[m.length - 1];
    return { file, status: m[0][0], add: (stats[file] || {}).add || 0, del: (stats[file] || {}).del || 0 };
  });
  return {
    hash: full, short, author, email, date, body,
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    files,
  };
}

async function changeStats(cwd) {
  const parse = (out) => {
    const m = {};
    out.split('\n').map((l) => l.trim()).filter(Boolean).forEach((l) => {
      const p = l.split('\t');
      if (p.length >= 3) m[p[2]] = { add: p[0] === '-' ? 0 : +p[0], del: p[1] === '-' ? 0 : +p[1] };
    });
    return m;
  };
  const [uns, stg] = await Promise.all([
    git(cwd, ['diff', '--numstat']),
    git(cwd, ['diff', '--cached', '--numstat']),
  ]);
  return { unstaged: parse(uns.stdout), staged: parse(stg.stdout) };
}

async function status(cwd) {
  const r = await git(cwd, ['status', '--porcelain=v1', '--untracked-files=all', '-z']);
  const staged = [];
  const unstaged = [];
  const parts = r.stdout.split('\0').filter((s) => s.length);
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    const x = entry[0];
    const y = entry[1];
    let file = entry.slice(3);
    if (x === 'R' || y === 'R') { i++; /* пропускаем old-path у переименования */ }
    if (x !== ' ' && x !== '?') staged.push({ file, code: x });
    if (y !== ' ') unstaged.push({ file, code: (y === '?' ? '?' : y) });
  }
  return { staged, unstaged };
}

async function diffFile(cwd, file, { staged = false } = {}) {
  const args = ['diff', '--no-color'];
  if (staged) args.push('--cached');
  args.push('--', file);
  const r = await git(cwd, args);
  // для новых (untracked) файлов git diff пуст — покажем содержимое как добавление
  if (!r.stdout.trim() && !staged) {
    const show = await run('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', file], { cwd });
    return show.stdout || r.stdout;
  }
  return r.stdout;
}

async function commitFiles(cwd, hash) {
  const r = await git(cwd, ['show', '--no-color', '--name-status', '--pretty=format:', hash]);
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.split('\t');
    return { code: m[0], file: m[m.length - 1] };
  });
}

async function commitDiff(cwd, hash, file) {
  const r = await git(cwd, ['show', '--no-color', hash, '--', file]);
  return r.stdout;
}

const stage = (cwd, file) => git(cwd, ['add', '--', file]);
const unstage = (cwd, file) => git(cwd, ['reset', '-q', 'HEAD', '--', file]);
const stageAll = (cwd) => git(cwd, ['add', '-A']);

async function commit(cwd, message, onData) {
  return git(cwd, ['commit', '-m', message], onData);
}
const push = (cwd, onData) => git(cwd, ['push'], onData);
const pull = (cwd, onData) => git(cwd, ['pull', '--ff-only'], onData);
const fetch = (cwd, onData) => git(cwd, ['fetch', '--all', '--prune'], onData);
const checkout = (cwd, branch, onData) => git(cwd, ['checkout', branch], onData);

async function aheadBehind(cwd) {
  const r = await git(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  if (r.code !== 0) return { ahead: 0, behind: 0, hasUpstream: false };
  const [a, b] = r.stdout.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
  return { ahead: a, behind: b, hasUpstream: true };
}

// ---- Ветки ----
const branchCreate = (cwd, name, onData) => git(cwd, ['checkout', '-b', name], onData);
const branchDelete = (cwd, name, onData) => git(cwd, ['branch', '-D', name], onData);
const merge = (cwd, name, onData) => git(cwd, ['merge', '--no-edit', name], onData);
function clone(url, dir, onData) {
  const parent = require('path').dirname(dir);
  const name = require('path').basename(dir);
  return run('git', ['clone', url, name], { cwd: parent, onData });
}

// ---- Откат / stash / amend ----
function discard(cwd, file, untracked, onData) {
  if (untracked) return git(cwd, ['clean', '-f', '--', file], onData);
  return git(cwd, ['checkout', '--', file], onData);
}
const stashPush = (cwd, onData) => git(cwd, ['stash', 'push', '--include-untracked'], onData);
const stashPop = (cwd, onData) => git(cwd, ['stash', 'pop'], onData);
async function stashList(cwd) {
  const r = await git(cwd, ['stash', 'list']);
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}
const amend = (cwd, message, onData) => git(cwd, ['commit', '--amend', '-m', message], onData);

module.exports = {
  isRepo, currentBranch, branches, log, logGraph, commitStat, changeStats, status, diffFile,
  commitFiles, commitDiff, stage, unstage, stageAll, commit,
  push, pull, fetch, checkout, aheadBehind,
  branchCreate, branchDelete, merge, clone,
  discard, stashPush, stashPop, stashList, amend,
};
