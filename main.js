'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const git = require('./lib/git');
const onec = require('./lib/onec');
const bsl = require('./lib/bsl-lint');
const settings = require('./lib/settings');

let win = null;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
// стример вывода процесса в консоль рендерера
const streamer = (d, stream) => send('proc:data', { chunk: d, stream });

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#1e1e1e',
    title: '1С DevOps Studio',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Диагностика: проброс консоли рендерера и ошибок preload в stdout
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    console.log(`[renderer:${level}] ${message} (${source}:${line})`);
  });
  win.webContents.on('preload-error', (_e, p, err) => console.log('[preload-error]', p, err && err.stack || err));
  win.webContents.on('render-process-gone', (_e, d) => console.log('[render-gone]', JSON.stringify(d)));
  if (process.env.ONEC_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' });
}

function setupUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => send('update:status', { state: 'checking' }));
  autoUpdater.on('update-available', (i) => send('update:status', { state: 'available', version: i.version }));
  autoUpdater.on('update-not-available', () => send('update:status', { state: 'none', version: app.getVersion() }));
  autoUpdater.on('download-progress', (p) => send('update:status', { state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (i) => send('update:status', { state: 'downloaded', version: i.version }));
  autoUpdater.on('error', (e) => send('update:status', { state: 'error', message: String(e && e.message || e) }));
  if (app.isPackaged) { autoUpdater.checkForUpdates().catch(() => {}); }
}

app.whenReady().then(() => {
  settings.setPath(path.join(app.getPath('userData'), 'settings.json'));
  createWindow();
  setupUpdater();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

ipcMain.handle('update:version', () => app.getVersion());
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { dev: true };
  try { const r = await autoUpdater.checkForUpdates(); return { ok: true, version: r && r.updateInfo && r.updateInfo.version }; }
  catch (e) { return { error: String(e && e.message || e) }; }
});
ipcMain.handle('update:install', () => { setImmediate(() => autoUpdater.quitAndInstall(false, true)); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------- Управление окном ----------
ipcMain.handle('win:min', () => win && win.minimize());
ipcMain.handle('win:max', () => { if (!win) return; if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
ipcMain.handle('win:close', () => win && win.close());

// ---------- Settings ----------
ipcMain.handle('settings:get', () => settings.load());
ipcMain.handle('settings:save', (_e, data) => settings.save(data));

// ---------- Dialogs ----------
ipcMain.handle('dialog:pickDir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:pickFile', async (_e, filters) => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: filters || [{ name: '1С', extensions: ['cf', 'cfe', 'epf', 'erf'] }, { name: 'Все', extensions: ['*'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:saveFile', async (_e, opts) => {
  const r = await dialog.showSaveDialog(win, opts || {});
  return r.canceled ? null : r.filePath;
});

// ---------- Git ----------
ipcMain.handle('git:info', async (_e, repo) => {
  const isRepo = await git.isRepo(repo);
  if (!isRepo) return { isRepo: false };
  const [branch, ab] = await Promise.all([git.currentBranch(repo), git.aheadBehind(repo)]);
  return { isRepo: true, branch, aheadBehind: ab };
});
ipcMain.handle('git:log', (_e, repo) => git.log(repo));
ipcMain.handle('git:logGraph', (_e, repo) => git.logGraph(repo));
ipcMain.handle('git:commitStat', (_e, { repo, hash }) => git.commitStat(repo, hash));
ipcMain.handle('git:changeStats', (_e, repo) => git.changeStats(repo));
ipcMain.handle('git:status', (_e, repo) => git.status(repo));
ipcMain.handle('git:diffFile', (_e, { repo, file, staged }) => git.diffFile(repo, file, { staged }));
ipcMain.handle('git:commitFiles', (_e, { repo, hash }) => git.commitFiles(repo, hash));
ipcMain.handle('git:commitDiff', (_e, { repo, hash, file }) => git.commitDiff(repo, hash, file));
ipcMain.handle('git:stage', (_e, { repo, file }) => git.stage(repo, file));
ipcMain.handle('git:unstage', (_e, { repo, file }) => git.unstage(repo, file));
ipcMain.handle('git:stageAll', (_e, repo) => git.stageAll(repo));
ipcMain.handle('git:branches', (_e, repo) => git.branches(repo));

ipcMain.handle('git:commit', async (_e, { repo, message }) => {
  send('proc:begin', { title: 'git commit' });
  const r = await git.commit(repo, message, streamer);
  send('proc:end', { code: r.code });
  return r;
});
ipcMain.handle('git:push', async (_e, repo) => {
  send('proc:begin', { title: 'git push' });
  const r = await git.push(repo, streamer);
  send('proc:end', { code: r.code });
  return r;
});
ipcMain.handle('git:pull', async (_e, repo) => {
  send('proc:begin', { title: 'git pull' });
  const r = await git.pull(repo, streamer);
  send('proc:end', { code: r.code });
  return r;
});
ipcMain.handle('git:fetch', async (_e, repo) => {
  send('proc:begin', { title: 'git fetch' });
  const r = await git.fetch(repo, streamer);
  send('proc:end', { code: r.code });
  return r;
});
ipcMain.handle('git:checkout', async (_e, { repo, branch }) => {
  send('proc:begin', { title: `git checkout ${branch}` });
  const r = await git.checkout(repo, branch, streamer);
  send('proc:end', { code: r.code });
  return r;
});

function gitProc(title, fn) {
  return async (...args) => {
    send('proc:begin', { title });
    const r = await fn(...args);
    send('proc:end', { code: r.code });
    return r;
  };
}
ipcMain.handle('git:branchCreate', (_e, { repo, name }) => gitProc(`git checkout -b ${name}`, () => git.branchCreate(repo, name, streamer))());
ipcMain.handle('git:branchDelete', (_e, { repo, name }) => gitProc(`git branch -D ${name}`, () => git.branchDelete(repo, name, streamer))());
ipcMain.handle('git:merge', (_e, { repo, name }) => gitProc(`git merge ${name}`, () => git.merge(repo, name, streamer))());
ipcMain.handle('git:clone', (_e, { url, dir }) => gitProc(`git clone ${url}`, () => git.clone(url, dir, streamer))());
ipcMain.handle('git:discard', (_e, { repo, file, untracked }) => git.discard(repo, file, untracked));
ipcMain.handle('git:stashPush', (_e, repo) => gitProc('git stash', () => git.stashPush(repo, streamer))());
ipcMain.handle('git:stashPop', (_e, repo) => gitProc('git stash pop', () => git.stashPop(repo, streamer))());
ipcMain.handle('git:stashList', (_e, repo) => git.stashList(repo));
ipcMain.handle('git:amend', (_e, { repo, message }) => gitProc('git commit --amend', () => git.amend(repo, message, streamer))());

// ---------- BSL проверка ----------
ipcMain.handle('bsl:lint', async (_e, repo) => {
  const st = await git.status(repo);
  const files = [...new Set([...st.staged, ...st.unstaged].map((f) => f.file))];
  return { files: files.length, findings: bsl.lintFiles(repo, files) };
});

// ---------- 1С операции ----------
ipcMain.handle('onec:exec', async (_e, req) => {
  const { op, exe, base, ext } = req;
  send('proc:begin', { title: `1С: ${op}` });
  let r = { code: -1, output: 'неизвестная операция' };
  try {
    switch (op) {
      case 'dumpConfigToFiles': r = await onec.dumpConfigToFiles(exe, base, req.dir, ext, streamer); break;
      case 'loadConfigFromFiles': r = await onec.loadConfigFromFiles(exe, base, req.dir, ext, streamer); break;
      case 'dumpCfg': r = await onec.dumpCfg(exe, base, req.file, ext, streamer); break;
      case 'loadCfg': r = await onec.loadCfg(exe, base, req.file, ext, streamer); break;
      case 'updateDBCfg': r = await onec.updateDBCfg(exe, base, ext, streamer); break;
      case 'v8extract': r = await onec.v8unpack(req.python, 'extract', req.src, req.dst, streamer); break;
      case 'v8build': r = await onec.v8unpack(req.python, 'build', req.src, req.dst, streamer); break;
      case 'startEnterprise': r = onec.startBase(exe, base, 'enterprise', streamer); break;
      case 'startDesigner': r = onec.startBase(exe, base, 'designer', streamer); break;
      case 'probeLock': r = await onec.probeLock(exe, base, streamer); break;
      case 'dumpIB': r = await onec.dumpIB(exe, base, req.file, streamer); break;
      case 'pushExtension': r = await onec.pushExtension(req.repo, streamer); break;
      case 'buildCfFromXml': r = await onec.buildCfFromXml(exe, req.dir, req.file, ext, streamer); break;
      case 'validateXml': r = await onec.validateXml(exe, req.dir, ext, streamer); break;
      case 'unpackCfToXml': r = await onec.unpackCfToXml(exe, req.file, req.dir, ext, streamer); break;
      default: streamer(`Неизвестная операция: ${op}\n`, 'stderr');
    }
  } catch (err) {
    streamer(String(err && err.message || err) + '\n', 'stderr');
    r = { code: -1, output: String(err) };
  }
  send('proc:end', { code: r.code });
  return r;
});
