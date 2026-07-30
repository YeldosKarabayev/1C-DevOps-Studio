'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./exec');

// Аргументы подключения к базе для DESIGNER
function connArgs(base) {
  const a = [];
  if (!base) return a;
  if (base.kind === 'server') {
    a.push('/S', `${base.server}\\${base.ref}`);
  } else {
    a.push('/F', base.path);
  }
  if (base.user) a.push('/N', base.user);
  if (base.pass) a.push('/P', base.pass);
  return a;
}

function readOutLog(logPath) {
  try {
    if (!fs.existsSync(logPath)) return '';
    const buf = fs.readFileSync(logPath);
    // 1С /Out обычно UTF-8 или UTF-16LE; определим по BOM
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      return buf.toString('utf16le').replace(/^﻿/, '');
    }
    return buf.toString('utf8').replace(/^﻿/, '');
  } catch (_) { return ''; }
}

/**
 * Универсальный запуск DESIGNER (1cv8.exe /DESIGNER ...).
 * platformExe — путь к 1cv8.exe. base — объект базы. opArgs — массив аргументов операции.
 * onData стримит псевдо-прогресс; реальный результат — из /Out лог-файла.
 */
async function designer(platformExe, base, opArgs, onData) {
  if (!platformExe || !fs.existsSync(platformExe)) {
    return { code: -1, output: `1cv8.exe не найден: ${platformExe}` };
  }
  const logPath = path.join(os.tmpdir(), `onec-designer-${Date.now()}.log`);
  const args = [
    'DESIGNER',
    ...connArgs(base),
    '/DisableStartupDialogs', '/DisableStartupMessages',
    ...opArgs,
    '/Out', logPath,
  ];
  if (onData) onData(`> "${platformExe}" ${args.map(q).join(' ')}\n`, 'cmd');
  const r = await run(platformExe, args, {
    onData: (d, s) => { if (onData) onData(d, s); },
  });
  const log = readOutLog(logPath);
  try { fs.unlinkSync(logPath); } catch (_) {}
  if (onData && log) onData(log + '\n', r.code === 0 ? 'stdout' : 'stderr');
  if (onData) onData(`[код возврата: ${r.code}]\n`, r.code === 0 ? 'ok' : 'stderr');
  return { code: r.code, output: log || r.stdout || r.stderr };
}

function q(s) { return /\s/.test(s) ? `"${s}"` : s; }

// ---- Операции с конфигурацией / расширением через DESIGNER ----

function dumpConfigToFiles(exe, base, outDir, ext, onData) {
  const op = ['/DumpConfigToFiles', outDir];
  if (ext) op.push('-Extension', ext);
  return designer(exe, base, op, onData);
}
function loadConfigFromFiles(exe, base, srcDir, ext, onData) {
  const op = ['/LoadConfigFromFiles', srcDir];
  if (ext) op.push('-Extension', ext);
  return designer(exe, base, op, onData);
}
function dumpCfg(exe, base, cfPath, ext, onData) {
  const op = ['/DumpCfg', cfPath];
  if (ext) op.push('-Extension', ext);
  return designer(exe, base, op, onData);
}
function loadCfg(exe, base, cfPath, ext, onData) {
  const op = ['/LoadCfg', cfPath];
  if (ext) op.push('-Extension', ext);
  return designer(exe, base, op, onData);
}
function updateDBCfg(exe, base, ext, onData) {
  const op = ['/UpdateDBCfg'];
  if (ext) op.push('-Extension', ext);
  return designer(exe, base, op, onData);
}

// ---- v8unpack (без платформы) ----

async function v8unpack(python, mode, src, dst, onData) {
  // mode: 'extract' | 'build'
  const flag = mode === 'build' ? '-B' : '-E';
  const args = ['-m', 'v8unpack', flag];
  if (mode === 'build') { args.push(src, dst); } // src=папка, dst=файл
  else {
    const temp = path.join(os.tmpdir(), `v8unpack-${Date.now()}`);
    args.push(src, dst, '--temp', temp);
  }
  if (onData) onData(`> "${python}" ${args.map(q).join(' ')}\n`, 'cmd');
  const r = await run(python, args, { onData });
  if (r.code === 9009 || /No module named v8unpack/i.test(r.stderr)) {
    if (onData) onData('v8unpack не установлен. Установите: pip install v8unpack\n', 'stderr');
  }
  if (onData) onData(`[код возврата: ${r.code}]\n`, r.code === 0 ? 'ok' : 'stderr');
  return { code: r.code, output: r.stdout || r.stderr };
}

module.exports = {
  dumpConfigToFiles, loadConfigFromFiles, dumpCfg, loadCfg, updateDBCfg, v8unpack,
};
