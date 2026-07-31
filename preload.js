'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (data) => ipcRenderer.invoke('settings:save', data),
  },
  dialog: {
    pickDir: () => ipcRenderer.invoke('dialog:pickDir'),
    pickFile: (filters) => ipcRenderer.invoke('dialog:pickFile', filters),
    saveFile: (opts) => ipcRenderer.invoke('dialog:saveFile', opts),
  },
  git: {
    info: (repo) => ipcRenderer.invoke('git:info', repo),
    log: (repo) => ipcRenderer.invoke('git:log', repo),
    logGraph: (repo) => ipcRenderer.invoke('git:logGraph', repo),
    commitStat: (repo, hash) => ipcRenderer.invoke('git:commitStat', { repo, hash }),
    changeStats: (repo) => ipcRenderer.invoke('git:changeStats', repo),
    status: (repo) => ipcRenderer.invoke('git:status', repo),
    diffFile: (repo, file, staged) => ipcRenderer.invoke('git:diffFile', { repo, file, staged }),
    commitFiles: (repo, hash) => ipcRenderer.invoke('git:commitFiles', { repo, hash }),
    commitDiff: (repo, hash, file) => ipcRenderer.invoke('git:commitDiff', { repo, hash, file }),
    stage: (repo, file) => ipcRenderer.invoke('git:stage', { repo, file }),
    unstage: (repo, file) => ipcRenderer.invoke('git:unstage', { repo, file }),
    stageAll: (repo) => ipcRenderer.invoke('git:stageAll', repo),
    branches: (repo) => ipcRenderer.invoke('git:branches', repo),
    commit: (repo, message) => ipcRenderer.invoke('git:commit', { repo, message }),
    push: (repo) => ipcRenderer.invoke('git:push', repo),
    pull: (repo) => ipcRenderer.invoke('git:pull', repo),
    fetch: (repo) => ipcRenderer.invoke('git:fetch', repo),
    checkout: (repo, branch) => ipcRenderer.invoke('git:checkout', { repo, branch }),
    branchCreate: (repo, name) => ipcRenderer.invoke('git:branchCreate', { repo, name }),
    branchDelete: (repo, name) => ipcRenderer.invoke('git:branchDelete', { repo, name }),
    merge: (repo, name) => ipcRenderer.invoke('git:merge', { repo, name }),
    clone: (url, dir) => ipcRenderer.invoke('git:clone', { url, dir }),
    discard: (repo, file, untracked) => ipcRenderer.invoke('git:discard', { repo, file, untracked }),
    stashPush: (repo) => ipcRenderer.invoke('git:stashPush', repo),
    stashPop: (repo) => ipcRenderer.invoke('git:stashPop', repo),
    stashList: (repo) => ipcRenderer.invoke('git:stashList', repo),
    amend: (repo, message) => ipcRenderer.invoke('git:amend', { repo, message }),
  },
  onec: {
    exec: (req) => ipcRenderer.invoke('onec:exec', req),
  },
  bsl: {
    lint: (repo) => ipcRenderer.invoke('bsl:lint', repo),
  },
  onProc: (cb) => {
    ipcRenderer.on('proc:begin', (_e, d) => cb('begin', d));
    ipcRenderer.on('proc:data', (_e, d) => cb('data', d));
    ipcRenderer.on('proc:end', (_e, d) => cb('end', d));
  },
});
