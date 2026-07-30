'use strict';
(() => {
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const api = window.api;

let settings = null;
let repo = null;          // текущий путь репозитория
let selCommit = null;
let selChangeFile = null;

// ---------- init ----------
async function init() {
  settings = await api.settings.get();
  applyTheme(settings.theme);
  fillRepoSelect();
  fillPlatformSelect();
  fillBaseSelect();
  $('#pyPath').value = settings.v8unpackPython || '';
  wireNav();
  wireConsole();
  wireGitActions();
  wireOnec();
  wireSettings();
  wireExtra();
  repo = currentRepoPath();
  await refreshRepo();
}

function currentRepoPath() {
  const idx = $('#repoSelect').value;
  return settings.repos[idx] ? settings.repos[idx].path : null;
}

function fillRepoSelect() {
  const sel = $('#repoSelect');
  sel.innerHTML = settings.repos.map((r, i) => `<option value="${i}">${esc(r.name)}</option>`).join('')
    || '<option>— нет репозиториев —</option>';
  sel.onchange = async () => { repo = currentRepoPath(); await refreshRepo(); };
}
function fillPlatformSelect() {
  const sel = $('#platformSelect');
  sel.innerHTML = (settings.platforms || []).map((p) => {
    const ver = p.match(/1cv8[\\/](\d+\.\d+\.\d+\.\d+)/i);
    return `<option value="${esc(p)}">${ver ? ver[1] : p}</option>`;
  }).join('') || '<option value="">— платформа не найдена —</option>';
  if (settings.activePlatform) sel.value = settings.activePlatform;
}
function fillBaseSelect() {
  const sel = $('#baseSelect');
  sel.innerHTML = (settings.bases || []).map((b, i) => {
    const loc = b.kind === 'server' ? `${b.server}\\${b.ref}` : b.path;
    return `<option value="${i}">${esc(b.name)} — ${esc(loc || '')}</option>`;
  }).join('') || '<option value="">— базы не заданы (Настройки) —</option>';
  sel.onchange = () => {
    const b = settings.bases[sel.value];
    if (b && b.extension && !$('#extName').value) $('#extName').value = b.extension;
  };
  sel.onchange();
}

// ---------- navigation ----------
function wireNav() {
  $$('.nav-item').forEach((btn) => btn.addEventListener('click', () => {
    $$('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    $$('.view').forEach((v) => v.classList.add('hidden'));
    $(`#view-${view}`).classList.remove('hidden');
    if (view === 'history') loadLog();
    if (view === 'changes') loadStatus();
    if (view === 'settings') renderSettings();
  }));
  $('#refreshLog').onclick = loadLog;
  $('#refreshStatus').onclick = loadStatus;
  $('#themeToggle').onclick = () => {
    const t = settings.theme === 'dark' ? 'light' : 'dark';
    settings.theme = t; applyTheme(t); api.settings.save(settings);
  };
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t || 'dark');
  $('#themeToggle').textContent = t === 'light' ? '☀ Тема' : '🌙 Тема';
}

// ---------- repo / branch ----------
async function refreshRepo() {
  if (!repo) return;
  const info = await api.git.info(repo);
  const bsel = $('#branchSelect');
  if (!info.isRepo) {
    bsel.innerHTML = '<option>— не git-репозиторий —</option>';
    $('#syncBadge').textContent = '';
    return;
  }
  const branches = await api.git.branches(repo);
  bsel.innerHTML = branches.map((b) => `<option ${b === info.branch ? 'selected' : ''}>${esc(b)}</option>`).join('');
  bsel.onchange = async () => { await api.git.checkout(repo, bsel.value); await refreshRepo(); loadLog(); };
  const ab = info.aheadBehind || {};
  $('#syncBadge').textContent = ab.hasUpstream ? `↑${ab.ahead} ↓${ab.behind}` : 'нет upstream';
  const active = $$('.nav-item').find((b) => b.classList.contains('active'));
  const view = active ? active.dataset.view : 'history';
  if (view === 'history') loadLog(); else if (view === 'changes') loadStatus(); else loadStatus(true);
}

// ---------- History ----------
async function loadLog() {
  if (!repo) return;
  const list = $('#commitList');
  list.innerHTML = '<div class="empty">Загрузка…</div>';
  const res = await api.git.log(repo);
  if (res.error) { list.innerHTML = `<div class="empty">${esc(res.error)}</div>`; return; }
  if (!res.commits.length) { list.innerHTML = '<div class="empty">Нет коммитов</div>'; return; }
  list.innerHTML = res.commits.map((c) => `
    <div class="commit-row" data-hash="${c.hash}">
      <div class="commit-subject">${esc(c.subject)}</div>
      <div class="commit-meta"><span class="commit-hash">${c.short}</span><span>${esc(c.author)}</span><span>${esc(c.rel)}</span></div>
    </div>`).join('');
  list.querySelectorAll('.commit-row').forEach((row) => row.onclick = () => selectCommit(row));
}
async function selectCommit(row) {
  $$('.commit-row').forEach((r) => r.classList.remove('sel'));
  row.classList.add('sel');
  selCommit = row.dataset.hash;
  $('#commitHead').textContent = row.querySelector('.commit-subject').textContent;
  const files = await api.git.commitFiles(repo, selCommit);
  const fl = $('#commitFiles');
  fl.className = 'file-list small';
  fl.innerHTML = files.map((f) => fileRowHTML(f.file, f.code)).join('') || '<div class="empty">Нет файлов</div>';
  $('#commitDiff').innerHTML = '';
  fl.querySelectorAll('.file-row').forEach((r) => r.onclick = async () => {
    fl.querySelectorAll('.file-row').forEach((x) => x.classList.remove('sel'));
    r.classList.add('sel');
    const diff = await api.git.commitDiff(repo, selCommit, r.dataset.file);
    $('#commitDiff').innerHTML = colorizeDiff(diff);
  });
}

// ---------- Changes ----------
async function loadStatus(badgeOnly) {
  if (!repo) return;
  const st = await api.git.status(repo);
  const total = st.staged.length + st.unstaged.length;
  const badge = $('#changesBadge');
  badge.textContent = total; badge.classList.toggle('hidden', total === 0);
  if (badgeOnly) return;
  $('#stagedList').innerHTML = st.staged.map((f) => fileRowHTML(f.file, f.code, 'unstage')).join('') || '<div class="empty">Пусто</div>';
  $('#unstagedList').innerHTML = st.unstaged.map((f) => fileRowHTML(f.file, f.code, 'stage')).join('') || '<div class="empty">Пусто</div>';
  bindChangeRows('#stagedList', true);
  bindChangeRows('#unstagedList', false);
}
function bindChangeRows(sel, staged) {
  $$(`${sel} .file-row`).forEach((r) => {
    r.onclick = async (e) => {
      if (e.target.classList.contains('file-act')) return;
      $$('.file-row').forEach((x) => x.classList.remove('sel'));
      r.classList.add('sel');
      selChangeFile = r.dataset.file;
      $('#changeHead').textContent = r.dataset.file;
      const diff = await api.git.diffFile(repo, r.dataset.file, staged);
      $('#changeDiff').innerHTML = colorizeDiff(diff);
    };
    const discardBtn = r.querySelector('.file-act.discard');
    if (discardBtn) discardBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Отменить изменения в файле?\n${r.dataset.file}`)) return;
      await api.git.discard(repo, r.dataset.file, r.dataset.code === '?');
      loadStatus();
    };
    const act = r.querySelector('.file-act:not(.discard)');
    if (act) act.onclick = async (e) => {
      e.stopPropagation();
      if (staged) await api.git.unstage(repo, r.dataset.file);
      else await api.git.stage(repo, r.dataset.file);
      loadStatus();
    };
  });
}

function wireGitActions() {
  $('#btnFetch').onclick = () => run(() => api.git.fetch(repo), refreshRepo);
  $('#btnPull').onclick = () => run(() => api.git.pull(repo), () => { refreshRepo(); loadLog(); });
  $('#btnPush').onclick = () => run(() => api.git.push(repo), refreshRepo);
  $('#stageAll').onclick = async () => { await api.git.stageAll(repo); loadStatus(); };
  $('#btnCommit').onclick = async () => {
    const msg = $('#commitMsg').value.trim();
    if (!msg) { toastConsole('Введите сообщение коммита', 'stderr'); return; }
    const amend = $('#amendChk').checked;
    const fn = amend ? () => api.git.amend(repo, msg) : () => api.git.commit(repo, msg);
    await run(fn, () => { $('#commitMsg').value = ''; $('#amendChk').checked = false; loadStatus(); loadLog(); refreshRepo(); });
  };
}

function wireExtra() {
  // Ветки
  $('#branchNew').onclick = async () => {
    const v = await modalPrompt('Новая ветка', [{ key: 'name', label: 'Имя ветки' }]);
    if (v && v.name) await run(() => api.git.branchCreate(repo, v.name.trim()), () => { refreshRepo(); loadLog(); });
  };
  $('#branchMerge').onclick = async () => {
    const v = await modalPrompt('Слить ветку в текущую', [{ key: 'name', label: 'Какую ветку слить' }]);
    if (v && v.name) await run(() => api.git.merge(repo, v.name.trim()), () => { refreshRepo(); loadLog(); });
  };
  $('#branchDel').onclick = async () => {
    const cur = $('#branchSelect').value;
    const v = await modalPrompt('Удалить ветку', [{ key: 'name', label: 'Имя ветки (не текущую)', value: '' }]);
    if (v && v.name) {
      if (v.name.trim() === cur) { toastConsole('Нельзя удалить текущую ветку', 'stderr'); return; }
      await run(() => api.git.branchDelete(repo, v.name.trim()), refreshRepo);
    }
  };
  // Stash
  $('#btnStash').onclick = () => run(() => api.git.stashPush(repo), loadStatus);
  $('#btnStashPop').onclick = () => run(() => api.git.stashPop(repo), () => { loadStatus(); loadLog(); });
  // BSL проверка
  $('#btnLint').onclick = async () => {
    $('#changeHead').textContent = 'Проверка BSL';
    $('#changeDiff').innerHTML = '<div class="empty">Анализ…</div>';
    const res = await api.bsl.lint(repo);
    renderLint(res);
  };
  // Clone
  $('#pickCloneDir').onclick = async () => { const d = await api.dialog.pickDir(); if (d) $('#cloneDir').value = d; };
  $('#btnClone').onclick = async () => {
    const url = $('#cloneUrl').value.trim();
    const dir = $('#cloneDir').value.trim();
    if (!url || !dir) { toastConsole('Укажите URL и целевую папку', 'stderr'); return; }
    await run(() => api.git.clone(url, dir), () => toastConsole('Готово. Добавьте склонированный репозиторий в список выше.', 'ok'));
  };
}

function renderLint(res) {
  const findings = (res && res.findings) || [];
  const head = `Проверка BSL — файлов: ${res ? res.files : 0}, находок: ${findings.length}`;
  $('#changeHead').textContent = head;
  if (!findings.length) { $('#changeDiff').innerHTML = '<div class="empty">✓ Антипаттернов не найдено в изменённых BSL-файлах</div>'; return; }
  const rows = findings.map((f) => `
    <div class="lint-row">
      <div class="lint-top"><span class="lint-sev ${f.severity}">${f.severity}</span>
        <span class="lint-loc">${esc(f.file)}:${f.line}</span></div>
      <div class="lint-msg">${esc(f.message)}</div>
      ${f.code ? `<div class="lint-code">${esc(f.code)}</div>` : ''}
    </div>`).join('');
  $('#changeDiff').innerHTML = `<div class="lint-list">${rows}</div>`;
}

// Модальный ввод текста (window.prompt в Electron отключён)
function modalPrompt(title, fields) {
  return new Promise((resolve) => {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = fields.map((f) =>
      `<div><label>${esc(f.label)}</label><input data-k="${f.key}" type="${f.type || 'text'}" value="${esc(f.value || '')}" /></div>`).join('');
    $('#modal').classList.remove('hidden');
    const first = $('#modalBody input'); if (first) first.focus();
    const cleanup = () => { $('#modal').classList.add('hidden'); $('#modalOk').onclick = null; $('#modalCancel').onclick = null; };
    $('#modalOk').onclick = () => { const r = {}; $$('#modalBody [data-k]').forEach((i) => r[i.dataset.k] = i.value); cleanup(); resolve(r); };
    $('#modalCancel').onclick = () => { cleanup(); resolve(null); };
  });
}

// ---------- 1С ----------
function wireOnec() {
  $('#platformSelect').onchange = () => { settings.activePlatform = $('#platformSelect').value; api.settings.save(settings); };
  $$('.act').forEach((btn) => btn.onclick = () => onecAction(btn.dataset.op));
}
async function onecAction(op) {
  const exe = $('#platformSelect').value;
  const base = settings.bases[$('#baseSelect').value] || null;
  const ext = $('#extName').value.trim();
  const python = settings.v8unpackPython || 'python';
  const req = { op, exe, base, ext, python };

  const needBase = ['dumpConfigToFiles', 'loadConfigFromFiles', 'dumpCfg', 'loadCfg', 'updateDBCfg',
    'startEnterprise', 'startDesigner', 'probeLock', 'dumpIB'];
  if (needBase.includes(op) && !base) { toastConsole('Сначала выберите базу (Настройки)', 'stderr'); return; }

  try {
    if (op === 'pushExtension') {
      req.repo = currentRepoPath();
      if (!req.repo) { toastConsole('Выберите репозиторий БУХ (со scripts/push-ext.ps1)', 'stderr'); return; }
    } else if (op === 'dumpIB') {
      const f = await api.dialog.saveFile({ filters: [{ name: 'Выгрузка ИБ', extensions: ['dt'] }] }); if (!f) return; req.file = f;
    } else if (op === 'dumpConfigToFiles' || op === 'loadConfigFromFiles') {
      const dir = await api.dialog.pickDir(); if (!dir) return; req.dir = dir;
    } else if (op === 'dumpCfg') {
      const f = await api.dialog.saveFile({ filters: [{ name: '1С', extensions: ['cf', 'cfe'] }] }); if (!f) return; req.file = f;
    } else if (op === 'loadCfg') {
      const f = await api.dialog.pickFile([{ name: '1С', extensions: ['cf', 'cfe'] }]); if (!f) return; req.file = f;
    } else if (op === 'v8extract') {
      const src = await api.dialog.pickFile([{ name: '1С', extensions: ['cf', 'cfe', 'epf', 'erf'] }]); if (!src) return;
      const dst = await api.dialog.pickDir(); if (!dst) return; req.src = src; req.dst = dst;
    } else if (op === 'v8build') {
      const src = await api.dialog.pickDir(); if (!src) return;
      const dst = await api.dialog.saveFile({ filters: [{ name: '1С', extensions: ['cf', 'cfe', 'epf', 'erf'] }] }); if (!dst) return;
      req.src = src; req.dst = dst;
    } else if (op === 'updateDBCfg') {
      // без путей
    }
    await run(() => api.onec.exec(req), null);
  } catch (e) { toastConsole(String(e), 'stderr'); }
}

// ---------- Settings ----------
function wireSettings() {
  $('#addRepo').onclick = () => { settings.repos.push({ name: 'repo', path: '' }); renderSettings(); };
  $('#addBase').onclick = () => { settings.bases.push({ name: 'base', kind: 'file', path: '', server: '', ref: '', user: '', pass: '', extension: '' }); renderSettings(); };
  $('#saveSettings').onclick = async () => {
    collectSettings();
    const ok = await api.settings.save(settings);
    $('#saveHint').textContent = ok ? 'Сохранено ✓' : 'Ошибка сохранения';
    setTimeout(() => $('#saveHint').textContent = '', 2500);
    fillRepoSelect(); fillBaseSelect(); repo = currentRepoPath(); refreshRepo();
  };
}
function renderSettings() {
  $('#repoRows').innerHTML = settings.repos.map((r, i) => `
    <div class="row-edit" data-i="${i}">
      <input class="r-name" value="${esc(r.name)}" placeholder="имя" />
      <input class="r-path" value="${esc(r.path)}" placeholder="путь" />
      <button class="del-row" data-del-repo="${i}">✕</button>
    </div>`).join('');
  $('#baseRows').innerHTML = settings.bases.map((b, i) => `
    <div class="row-edit base" data-i="${i}">
      <input class="b-name" value="${esc(b.name)}" placeholder="имя" />
      <input class="b-loc" value="${esc(b.kind === 'server' ? (b.server + '\\\\' + b.ref) : b.path)}" placeholder="файл-путь или сервер\\база" />
      <input class="b-user" value="${esc(b.user || '')}" placeholder="user" />
      <input class="b-pass" value="${esc(b.pass || '')}" placeholder="pass" type="password" />
      <button class="del-row" data-del-base="${i}">✕</button>
    </div>`).join('');
  $$('[data-del-repo]').forEach((b) => b.onclick = () => { settings.repos.splice(+b.dataset.delRepo, 1); renderSettings(); });
  $$('[data-del-base]').forEach((b) => b.onclick = () => { settings.bases.splice(+b.dataset.delBase, 1); renderSettings(); });
}
function collectSettings() {
  settings.repos = $$('#repoRows .row-edit').map((row) => ({
    name: row.querySelector('.r-name').value.trim(),
    path: row.querySelector('.r-path').value.trim(),
  })).filter((r) => r.path);
  settings.bases = $$('#baseRows .row-edit').map((row) => {
    const loc = row.querySelector('.b-loc').value.trim();
    const isServer = loc.includes('\\') && !/^[a-zA-Z]:\\/.test(loc);
    const b = {
      name: row.querySelector('.b-name').value.trim(),
      user: row.querySelector('.b-user').value.trim(),
      pass: row.querySelector('.b-pass').value,
      extension: '',
    };
    if (isServer) { const [s, r] = loc.split('\\'); b.kind = 'server'; b.server = s; b.ref = r; }
    else { b.kind = 'file'; b.path = loc; }
    return b;
  }).filter((b) => b.name);
  settings.v8unpackPython = $('#pyPath').value.trim();
  settings.activePlatform = $('#platformSelect').value;
}

// ---------- Console / process ----------
let running = false;
function wireConsole() {
  $('#clearConsole').onclick = () => { $('#consoleBody').innerHTML = ''; };
  $('#toggleConsole').onclick = () => {
    const c = $('#console'); c.classList.toggle('collapsed');
    $('#toggleConsole').textContent = c.classList.contains('collapsed') ? '▴' : '▾';
  };
  api.onProc((kind, d) => {
    if (kind === 'begin') { setSpinner(true); $('#consoleTitle').textContent = d.title; appendConsole(`\n▶ ${d.title}\n`, 'cmd'); }
    else if (kind === 'data') { appendConsole(d.chunk, d.stream); }
    else if (kind === 'end') { setSpinner(false); appendConsole(`■ завершено (код ${d.code})\n`, d.code === 0 ? 'ok' : 'stderr'); }
  });
}
function setSpinner(on) { running = on; $('#spinner').classList.toggle('hidden', !on); $$('.git-actions .tbtn').forEach((b) => b.disabled = on); }
function appendConsole(text, stream) {
  const span = document.createElement('span');
  span.className = stream === 'cmd' ? 'c-cmd' : stream === 'stderr' ? 'c-err' : (stream === 'ok' ? 'c-ok' : '');
  span.textContent = text;
  const body = $('#consoleBody'); body.appendChild(span); body.scrollTop = body.scrollHeight;
}
function toastConsole(msg, stream) { appendConsole(`\n${msg}\n`, stream || 'stdout'); }
async function run(fn, after) {
  if (running) { toastConsole('Дождитесь завершения текущей операции', 'stderr'); return; }
  try { const r = await fn(); if (after) await after(r); }
  catch (e) { toastConsole(String(e && e.message || e), 'stderr'); setSpinner(false); }
}

// ---------- helpers ----------
function fileRowHTML(file, code, act) {
  const cls = code === '?' ? 'st-new' : `st ${code}`;
  const label = code === '?' ? 'A' : code;
  let actBtn = '';
  if (act === 'stage') actBtn = `<button class="file-act discard" title="Отменить изменения">⟲</button><button class="file-act" title="В индекс">+</button>`;
  else if (act === 'unstage') actBtn = `<button class="file-act" title="Из индекса">−</button>`;
  return `<div class="file-row" data-file="${esc(file)}" data-code="${esc(code)}"><span class="${cls}">${label}</span><span class="file-path">${esc(file)}</span>${actBtn}</div>`;
}
function colorizeDiff(text) {
  if (!text) return '<div class="empty">Нет изменений</div>';
  return text.split('\n').map((line) => {
    const e = esc(line);
    if (/^\+/.test(line) && !/^\+\+\+/.test(line)) return `<span class="add">${e}</span>`;
    if (/^-/.test(line) && !/^---/.test(line)) return `<span class="del">${e}</span>`;
    if (/^@@/.test(line)) return `<span class="hunk">${e}</span>`;
    if (/^(diff |index |\+\+\+|---|new file|deleted)/.test(line)) return `<span class="meta">${e}</span>`;
    return e;
  }).join('\n');
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

window.addEventListener('error', (e) => console.error('WINDOW ERROR:', e.message, 'at', e.filename + ':' + e.lineno));
init().catch((err) => {
  const msg = (err && err.stack) || String(err);
  console.error('INIT FAILED:', msg);
  document.body.insertAdjacentHTML('afterbegin',
    `<pre style="position:fixed;top:0;left:0;right:0;z-index:999;background:#f85149;color:#fff;padding:10px;margin:0;white-space:pre-wrap">INIT ERROR: ${msg}</pre>`);
});
})();
