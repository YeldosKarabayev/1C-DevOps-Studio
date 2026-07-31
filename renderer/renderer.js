'use strict';
(() => {
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const api = window.api;

let settings = null;
let repo = null;          // текущий путь репозитория
let selCommit = null;
let selChangeFile = null;
let consoleHeight = 200, consoleCollapsed = false;
const _resizers = [];

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
  setupResizers();
  repo = currentRepoPath();
  await refreshRepo();
}

// ---------- Resizable panes ----------
function relayoutResizers() { _resizers.forEach((fn) => fn()); }

function colResizer(container, key, def, min, max) {
  if (!container) return;
  container.classList.add('rz');
  const g = document.createElement('div'); g.className = 'gutter gutter-col'; container.appendChild(g);
  let w = parseInt(localStorage.getItem(key), 10) || def;
  const apply = () => { container.style.gridTemplateColumns = w + 'px 1fr'; g.style.left = (w - 3) + 'px'; };
  apply(); _resizers.push(apply);
  g.addEventListener('mousedown', (e) => {
    e.preventDefault(); const sx = e.clientX, sw = w; document.body.classList.add('resizing');
    const mm = (ev) => { w = Math.max(min, Math.min(max, sw + (ev.clientX - sx))); apply(); };
    const mu = () => { document.body.classList.remove('resizing'); localStorage.setItem(key, w); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  });
}

function rowResizer(container, el, key, def, min, max) {
  if (!container || !el) return;
  container.classList.add('rz');
  const g = document.createElement('div'); g.className = 'gutter gutter-row'; container.appendChild(g);
  el.style.flex = 'none'; el.style.maxHeight = 'none';
  let h = parseInt(localStorage.getItem(key), 10) || def;
  const apply = () => { el.style.height = h + 'px'; g.style.top = (el.offsetTop + h - 3) + 'px'; };
  apply(); _resizers.push(apply);
  g.addEventListener('mousedown', (e) => {
    e.preventDefault(); const sy = e.clientY, sh = h; document.body.classList.add('resizing');
    const mm = (ev) => { h = Math.max(min, Math.min(max, sh + (ev.clientY - sy))); apply(); };
    const mu = () => { document.body.classList.remove('resizing'); localStorage.setItem(key, h); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  });
}

function consoleResizer() {
  const con = $('#console');
  consoleHeight = parseInt(localStorage.getItem('rz.console'), 10) || 200;
  con.style.height = consoleHeight + 'px';
  const g = document.createElement('div'); g.className = 'gutter gutter-row'; g.style.top = '-3px'; con.appendChild(g);
  g.addEventListener('mousedown', (e) => {
    e.preventDefault(); const sy = e.clientY, sh = con.offsetHeight; document.body.classList.add('resizing');
    const mm = (ev) => { consoleHeight = Math.max(41, Math.min(640, sh - (ev.clientY - sy))); con.style.height = consoleHeight + 'px'; consoleCollapsed = consoleHeight <= 44; };
    const mu = () => { document.body.classList.remove('resizing'); localStorage.setItem('rz.console', consoleHeight); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
  });
}

function setupResizers() {
  colResizer($('.split-history'), 'rz.hist.col', 420, 240, 1000);
  rowResizer($('#view-history .detail-split'), $('#commitFiles'), 'rz.hist.files', 200, 90, 640);
  colResizer($('#view-changes .split'), 'rz.chg.col', 360, 240, 1000);
  rowResizer($('#view-changes .list-pane'), $('#stagedList'), 'rz.chg.staged', 150, 60, 400);
  consoleResizer();
  window.addEventListener('resize', relayoutResizers);
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
    relayoutResizers();
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
const ROW_H = 56, LANE_W = 16, GPAD = 10;
async function loadLog() {
  if (!repo) return;
  const list = $('#commitList');
  list.innerHTML = '<div class="empty">Загрузка…</div>';
  $('#graphSvg').innerHTML = '';
  const res = await api.git.logGraph(repo);
  if (res.error) { list.innerHTML = `<div class="empty">${esc(res.error)}</div>`; return; }
  const commits = res.commits || [];
  $('#commitCount').textContent = commits.length;
  if (!commits.length) { list.innerHTML = '<div class="empty">Нет коммитов</div>'; return; }
  const { colOf, maxCol } = buildLanes(commits);
  const graphW = (maxCol + 1) * LANE_W + GPAD;
  renderGraphSvg(commits, colOf, maxCol, graphW);
  list.style.paddingLeft = graphW + 'px';
  list.innerHTML = commits.map((c) => commitRowHTML(c)).join('');
  list.querySelectorAll('.commit-row').forEach((row) => row.onclick = () => selectCommit(row));
}

// назначение колонок (lanes) для графа
function buildLanes(commits) {
  const colOf = {};
  const lanes = []; // хэши, ожидаемые в каждой колонке
  for (const c of commits) {
    let col = lanes.indexOf(c.hash);
    if (col === -1) { col = lanes.indexOf(null); if (col === -1) { col = lanes.length; lanes.push(c.hash); } else lanes[col] = c.hash; }
    colOf[c.hash] = col;
    // сходящиеся ветки: обнуляем прочие колонки, ждавшие этот же коммит
    for (let j = 0; j < lanes.length; j++) if (j !== col && lanes[j] === c.hash) lanes[j] = null;
    const ps = c.parents || [];
    if (ps.length === 0) { lanes[col] = null; }
    else {
      lanes[col] = ps[0];
      for (let k = 1; k < ps.length; k++) {
        if (lanes.indexOf(ps[k]) === -1) { const free = lanes.indexOf(null); if (free === -1) lanes.push(ps[k]); else lanes[free] = ps[k]; }
      }
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
  }
  const maxCol = Math.max(0, ...commits.map((c) => colOf[c.hash]));
  return { colOf, maxCol };
}

function renderGraphSvg(commits, colOf, maxCol, graphW) {
  const idx = {}; commits.forEach((c, i) => idx[c.hash] = i);
  const H = commits.length * ROW_H;
  const cx = (col) => GPAD / 2 + LANE_W / 2 + col * LANE_W;
  const cy = (i) => i * ROW_H + ROW_H / 2;
  const shades = [0.85, 0.5, 0.7, 0.4, 0.8, 0.55, 0.65];
  const links = [], nodes = [];
  commits.forEach((c, i) => {
    const x = cx(colOf[c.hash]), y = cy(i);
    const op = shades[colOf[c.hash] % shades.length];
    (c.parents || []).forEach((p) => {
      const pi = idx[p];
      if (pi == null) { links.push(`<path class="glink" d="M${x},${y} L${x},${y + ROW_H / 2}" stroke-opacity="${op}"/>`); return; }
      const px = cx(colOf[p]), py = cy(pi), m = (y + py) / 2;
      const d = px === x ? `M${x},${y} L${px},${py}` : `M${x},${y} C${x},${m} ${px},${m} ${px},${py}`;
      links.push(`<path class="glink" d="${d}" stroke-opacity="${op}"/>`);
    });
  });
  commits.forEach((c, i) => nodes.push(`<circle class="gnode" data-hash="${c.hash}" cx="${cx(colOf[c.hash])}" cy="${cy(i)}" r="4.5"/>`));
  const svg = $('#graphSvg');
  svg.setAttribute('width', graphW); svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${graphW} ${H}`);
  svg.innerHTML = links.join('') + nodes.join('');
}

function commitRowHTML(c) {
  const refs = (c.refs || []).map((r) => {
    const isHead = /HEAD/.test(r), isTag = /^tag:/.test(r);
    return `<span class="ref ${isHead ? 'ref-head' : isTag ? 'ref-tag' : 'ref-branch'}">${esc(r.replace(/^tag:\s*/, ''))}</span>`;
  }).join('');
  return `<div class="commit-row" data-hash="${c.hash}">
    <div class="commit-subject">${esc(c.subject)} ${refs}</div>
    <div class="commit-meta"><span class="commit-hash">${c.short}</span><span>${esc(c.author)}</span><span>·</span><span>${esc(c.rel)}</span></div>
  </div>`;
}

async function selectCommit(row) {
  $$('.commit-row').forEach((r) => r.classList.remove('sel'));
  row.classList.add('sel');
  selCommit = row.dataset.hash;
  $$('#graphSvg .gnode').forEach((n) => n.classList.toggle('sel', n.dataset.hash === selCommit));
  const d = await api.git.commitStat(repo, selCommit);
  const parents = (d.parents || []).map((p) => `<span class="commit-hash">${esc(p.slice(0, 7))}</span>`).join(' ');
  $('#commitDetail').innerHTML = `
    <div class="cd-msg">${esc(d.body).replace(/\n/g, '<br>')}</div>
    <div class="cd-meta">
      <span class="cd-author">${esc(d.author)}</span>
      <span class="cd-mut">&lt;${esc(d.email)}&gt;</span><span class="cd-mut">${esc(d.date)}</span>
      <span class="commit-hash">${esc(d.short)}</span>
      ${parents ? `<span class="cd-mut">↖</span>${parents}` : ''}
    </div>`;
  const files = d.files || [];
  $('#commitFilesCount').textContent = files.length;
  const fl = $('#commitFiles');
  fl.innerHTML = files.map((f) =>
    `<div class="file-row" data-file="${esc(f.file)}"><span class="st ${esc(f.status)}">${esc(f.status)}</span><span class="file-path">${esc(f.file)}</span><span class="stat"><span class="add">+${f.add}</span><span class="del">−${f.del}</span></span></div>`
  ).join('') || '<div class="empty">Нет файлов</div>';
  $('#commitDiff').innerHTML = '<div class="empty">Выберите файл</div>';
  fl.querySelectorAll('.file-row').forEach((r) => r.onclick = async () => {
    fl.querySelectorAll('.file-row').forEach((x) => x.classList.remove('sel'));
    r.classList.add('sel');
    const diff = await api.git.commitDiff(repo, selCommit, r.dataset.file);
    $('#commitDiff').innerHTML = renderDiff(diff);
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
  $('#commitBranch').textContent = $('#branchSelect').value || '—';
  const stats = await api.git.changeStats(repo).catch(() => ({ staged: {}, unstaged: {} }));
  $('#stagedList').innerHTML = st.staged.map((f) => fileRowHTML(f.file, f.code, 'unstage', stats.staged[f.file])).join('') || '<div class="empty">Пусто</div>';
  $('#unstagedList').innerHTML = st.unstaged.map((f) => fileRowHTML(f.file, f.code, 'stage', stats.unstaged[f.file])).join('') || '<div class="empty">Пусто</div>';
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
      $('#changeDiff').innerHTML = renderDiff(diff);
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
    const sum = $('#commitSummary').value.trim();
    const desc = $('#commitMsg').value.trim();
    if (!sum) { toastConsole('Введите summary коммита', 'stderr'); return; }
    const msg = desc ? `${sum}\n\n${desc}` : sum;
    const amend = $('#amendChk').checked;
    const fn = amend ? () => api.git.amend(repo, msg) : () => api.git.commit(repo, msg);
    await run(fn, () => { $('#commitSummary').value = ''; $('#commitMsg').value = ''; $('#amendChk').checked = false; loadStatus(); loadLog(); refreshRepo(); });
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
    const c = $('#console'); consoleCollapsed = !consoleCollapsed;
    c.style.height = consoleCollapsed ? '41px' : consoleHeight + 'px';
    $('#toggleConsole').textContent = consoleCollapsed ? '▴' : '▾';
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
function fileRowHTML(file, code, act, stat) {
  const cls = code === '?' ? 'st-new' : `st ${code}`;
  const label = code === '?' ? 'A' : code;
  let actBtn = '';
  if (act === 'stage') actBtn = `<button class="file-act discard" title="Отменить изменения">⟲</button><button class="file-act" title="В индекс">+</button>`;
  else if (act === 'unstage') actBtn = `<button class="file-act" title="Из индекса">−</button>`;
  const statHtml = stat ? `<span class="stat"><span class="add">+${stat.add || 0}</span><span class="del">−${stat.del || 0}</span></span>` : '';
  return `<div class="file-row" data-file="${esc(file)}" data-code="${esc(code)}"><span class="${cls}">${label}</span><span class="file-path">${esc(file)}</span>${statHtml}${actBtn}</div>`;
}
// diff с нумерацией строк (gutter), как в VS Code / GitHub
function renderDiff(text) {
  if (!text || !text.trim()) return '<div class="empty">Нет изменений</div>';
  let oldLn = 0, newLn = 0;
  const rows = [];
  const row = (cls, o, n, content) =>
    `<div class="dl ${cls}"><span class="gut">${o === '' ? '' : o}</span><span class="gut">${n === '' ? '' : n}</span><span class="dc">${esc(content) || '&nbsp;'}</span></div>`;
  for (const line of text.split('\n')) {
    if (/^(diff |index |--- |\+\+\+ |new file|deleted file|old mode|new mode|similarity|rename |Binary )/.test(line)) {
      rows.push(row('meta', '', '', line)); continue;
    }
    const hm = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hm) { oldLn = +hm[1]; newLn = +hm[2]; rows.push(row('hunk', '', '', line)); continue; }
    if (line.startsWith('+')) { rows.push(row('add', '', newLn, line)); newLn++; }
    else if (line.startsWith('-')) { rows.push(row('del', oldLn, '', line)); oldLn++; }
    else if (line.startsWith('\\')) { rows.push(row('meta', '', '', line)); }
    else { rows.push(row('ctx', oldLn, newLn, line)); oldLn++; newLn++; }
  }
  return `<div class="difftable">${rows.join('')}</div>`;
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
