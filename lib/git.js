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

module.exports = {
  isRepo, currentBranch, branches, log, status, diffFile,
  commitFiles, commitDiff, stage, unstage, stageAll, commit,
  push, pull, fetch, checkout, aheadBehind,
};
