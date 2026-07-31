'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

let settingsPath = null;

function setPath(p) { settingsPath = p; }

function defaults() {
  const home = os.homedir();
  const repos = [];

  // Автоподхват: репозиторий скиллов
  const skillsRepo = path.join(home, '.claude', 'skills');
  if (fs.existsSync(path.join(skillsRepo, '.git'))) {
    repos.push({ name: '1C-claude-skills', path: skillsRepo });
  }
  // Автоподхват: рабочий репозиторий БУХ (по типовому расположению)
  const buh = path.join(home, 'Desktop', 'Yeldos Desktop', 'Новая папка', 'BUH Cursor');
  if (fs.existsSync(path.join(buh, '.git'))) {
    repos.unshift({ name: '1C-AI_WORK_BASE (BUH)', path: buh });
  }

  // Автоподхват платформ 1С
  const platforms = detectPlatforms();

  // Автоподхват базы из .vscode/1c-server.json рабочего репо
  const bases = [];
  try {
    const cfg = path.join(buh, '.vscode', '1c-server.json');
    if (fs.existsSync(cfg)) {
      const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
      if (j.server && j.ref) {
        bases.push({
          name: j.ref, kind: 'server',
          server: j.server, ref: j.ref,
          user: j.user || '', pass: j.password || '',
          extension: j.extension || '',
        });
      }
    }
  } catch (_) { /* ignore */ }

  return {
    theme: 'dark',
    repos,
    platforms,
    activePlatform: platforms[0] || '',
    bases,
    v8unpackPython: detectPython(),
    backupDir: path.join(os.homedir(), 'Documents', '1C-Backups'),
  };
}

function detectPlatforms() {
  const out = [];
  for (const base of ['C:/Program Files/1cv8', 'C:/Program Files (x86)/1cv8']) {
    try {
      for (const d of fs.readdirSync(base)) {
        if (/^\d+\.\d+\.\d+\.\d+$/.test(d)) {
          const exe = path.join(base, d, 'bin', '1cv8.exe');
          if (fs.existsSync(exe)) out.push(exe);
        }
      }
    } catch (_) { /* dir absent */ }
  }
  return out.sort().reverse();
}

function detectPython() {
  const p = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe');
  return fs.existsSync(p) ? p : 'python';
}

function load() {
  try {
    if (settingsPath && fs.existsSync(settingsPath)) {
      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const def = defaults();
      // мягкий merge: сохранённое поверх дефолтов, но список платформ всегда пересканируем
      return { ...def, ...saved, platforms: def.platforms };
    }
  } catch (_) { /* corrupt -> defaults */ }
  return defaults();
}

function save(data) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { setPath, load, save, defaults, detectPlatforms };
