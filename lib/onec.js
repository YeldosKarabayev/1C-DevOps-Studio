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
    const srv = (base.port && String(base.port).trim() && String(base.port).trim() !== '1541')
      ? `${base.server}:${String(base.port).trim()}` : base.server;
    a.push('/S', `${srv}\\${base.ref}`);
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
function ensureParent(p) {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch (_) {}
}
function dumpCfg(exe, base, cfPath, ext, onData) {
  ensureParent(cfPath);
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
  const r = await run(python, args, { onData, env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  if (r.code === 9009 || /No module named v8unpack/i.test(r.stderr)) {
    if (onData) onData('v8unpack не установлен. Установите: pip install v8unpack\n', 'stderr');
  }
  if (onData) onData(`[код возврата: ${r.code}]\n`, r.code === 0 ? 'ok' : 'stderr');
  return { code: r.code, output: r.stdout || r.stderr };
}

// ---- Запуск базы (GUI, detached) ----
function startBase(exe, base, mode, onData) {
  if (!exe || !fs.existsSync(exe)) { if (onData) onData(`1cv8.exe не найден: ${exe}\n`, 'stderr'); return { code: -1 }; }
  const verb = mode === 'designer' ? 'DESIGNER' : 'ENTERPRISE';
  const args = [verb, ...connArgs(base), '/DisableStartupDialogs'];
  if (onData) onData(`> "${exe}" ${args.map(q).join(' ')}\n`, 'cmd');
  const { spawn } = require('child_process');
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  if (onData) onData(`[запущено: ${verb}]\n`, 'ok');
  return { code: 0 };
}

// ---- Проверка блокировки (best-effort) ----
async function probeLock(exe, base, onData) {
  if (!exe || !fs.existsSync(exe)) return { code: -1, output: '1cv8.exe не найден' };
  const logPath = path.join(os.tmpdir(), `onec-probe-${Date.now()}.log`);
  // быстрый безвредный DESIGNER-вызов: открывает базу и падает на несуществующем расширении
  const args = ['DESIGNER', ...connArgs(base), '/DisableStartupDialogs', '/DisableStartupMessages',
    '/DumpConfigToFiles', os.tmpdir(), '-Extension', '__probe_nonexistent__', '/Out', logPath];
  if (onData) onData(`> проверка блокировки базы…\n`, 'cmd');
  const r = await run(exe, args);
  const log = readOutLog(logPath);
  try { fs.unlinkSync(logPath); } catch (_) {}
  const has = (re) => re.test(log);

  // кто держит базу (если занята)
  let holder = '';
  const m = log.match(/пользователь:\s*([^,]+),\s*сеанс:\s*(\d+)[^,]*,[^,]*,\s*приложение:\s*([^\r\n.]+)/i);
  if (m) holder = ` Держит: ${m[1].trim()} (сеанс ${m[2]}, ${m[3].trim()}).`;

  let state, msg, stream, code;
  if (has(/(блокировк|заблокир|уже открыт|уже работает|работает конфигуратор|монопольн|exclusive|locked|используется другим)/i)) {
    state = 'locked'; code = 1; stream = 'stderr';
    msg = `⚠ База ЗАНЯТА — монопольный доступ невозможен, закройте Конфигуратор/сеансы.${holder}`;
  } else if (has(/(нет ответа от сервера|server_addr|timeout=|не удалось.{0,25}соедин|соединени|недоступ|DataExchange|сетев|rphost|ragent|не обнаружена информационная база|информационная база не обнаружена|не найдена информационная база)/i)) {
    state = 'unreachable'; code = 2; stream = 'stderr';
    msg = '✖ НЕ УДАЛОСЬ ПРОВЕРИТЬ — база недоступна (нет связи с сервером/база не отвечает). Проверьте, запущен ли сервер 1С и корректность адреса/имени базы.';
  } else if (has(/(расширени.{0,30}(не найден|не обнаруж|отсутств)|(не найден|не обнаруж).{0,30}расширени|__probe_nonexistent__)/i) || !has(/ошибк/i)) {
    state = 'free'; code = 0; stream = 'ok';
    msg = '✓ База свободна для операций (монопольный доступ доступен).';
  } else {
    state = 'unknown'; code = 3; stream = 'stderr';
    msg = '⚠ Не удалось однозначно определить статус — см. лог выше.';
  }
  // для свободной базы техническую строку пробинга (extension not found) не показываем — она сбивает с толку
  if (onData) { if (log && state !== 'free') onData(log + '\n', 'stderr'); onData(msg + '\n', stream); }
  return { code, output: msg };
}

// ---- Бэкап .dt ----
function dumpIB(exe, base, dtPath, onData) {
  ensureParent(dtPath);
  return designer(exe, base, ['/DumpIB', dtPath], onData);
}

// ---- Выложить расширение (обёртка push-ext.ps1 проекта) ----
async function pushExtension(repoPath, onData) {
  const script = path.join(repoPath, 'scripts', 'push-ext.ps1');
  if (!fs.existsSync(script)) {
    if (onData) onData(`Не найден скрипт: ${script}\nВыберите репозиторий БУХ, где лежит scripts/push-ext.ps1.\n`, 'stderr');
    return { code: -1 };
  }
  if (onData) onData(`> powershell -File "${script}"\n`, 'cmd');
  const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
    { cwd: repoPath, onData });
  if (onData) onData(`[код возврата: ${r.code}]\n`, r.code === 0 ? 'ok' : 'stderr');
  return { code: r.code, output: r.stdout || r.stderr };
}

// ---- Сборка .cf из XML-исходников (DumpConfigToFiles) через временную базу ----
async function createInfobase(exe, dir, onData) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  const logPath = path.join(os.tmpdir(), `onec-createib-${Date.now()}.log`);
  const args = ['CREATEINFOBASE', `File=${dir}`, '/DisableStartupDialogs', '/DisableStartupMessages', '/Out', logPath];
  if (onData) onData('> создание временной базы…\n', 'cmd');
  const r = await run(exe, args, {});
  const log = readOutLog(logPath); try { fs.unlinkSync(logPath); } catch (_) {}
  if (onData && log) onData(log + '\n', r.code === 0 ? 'stdout' : 'stderr');
  return r.code;
}

async function buildCfFromXml(exe, xmlDir, cfPath, ext, onData) {
  if (!exe || !fs.existsSync(exe)) return { code: -1, output: '1cv8.exe не найден' };
  if (!xmlDir || !fs.existsSync(path.join(xmlDir, 'Configuration.xml'))) {
    if (onData) onData(`Это не папка XML-исходников (нет Configuration.xml): ${xmlDir}\n`, 'stderr');
    return { code: -1, output: 'нет Configuration.xml' };
  }
  ensureParent(cfPath);
  const tmpBase = path.join(os.tmpdir(), `onec-buildcf-${Date.now()}`);
  const fileBase = { kind: 'file', path: tmpBase, user: '', pass: '' };
  if (onData) onData(`Сборка .cf из XML через временную базу:\n  XML: ${xmlDir}\n   →  ${cfPath}\n`, 'cmd');
  let code = await createInfobase(exe, tmpBase, onData);
  if (code !== 0) { cleanupDir(tmpBase); if (onData) onData('Не удалось создать временную базу.\n', 'stderr'); return { code, output: 'create failed' }; }
  let r = await designer(exe, fileBase, ['/LoadConfigFromFiles', xmlDir], onData);
  if (r.code !== 0) { cleanupDir(tmpBase); return r; }
  const op = ['/DumpCfg', cfPath];
  if (ext) op.push('-Extension', ext);
  r = await designer(exe, fileBase, op, onData);
  cleanupDir(tmpBase);
  if (onData) onData(r.code === 0 ? `✓ Готово: ${cfPath}\n` : 'Ошибка сборки .cf\n', r.code === 0 ? 'ok' : 'stderr');
  return r;
}
function cleanupDir(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }

// ---- Валидация XML-исходников (CheckConfig во временной базе) ----
async function validateXml(exe, xmlDir, ext, onData) {
  if (!exe || !fs.existsSync(exe)) return { code: -1, output: '1cv8.exe не найден' };
  if (!xmlDir || !fs.existsSync(path.join(xmlDir, 'Configuration.xml'))) {
    if (onData) onData(`Нет Configuration.xml в папке: ${xmlDir}\n`, 'stderr');
    return { code: -1, output: 'нет Configuration.xml' };
  }
  const tmpBase = path.join(os.tmpdir(), `onec-validate-${Date.now()}`);
  const fileBase = { kind: 'file', path: tmpBase, user: '', pass: '' };
  if (onData) onData(`Валидация XML во временной базе: ${xmlDir}\n`, 'cmd');
  let code = await createInfobase(exe, tmpBase, onData);
  if (code !== 0) { cleanupDir(tmpBase); return { code, output: 'create failed' }; }
  let r = await designer(exe, fileBase, ['/LoadConfigFromFiles', xmlDir, ...(ext ? ['-Extension', ext] : [])], onData);
  if (r.code !== 0) { cleanupDir(tmpBase); return r; }
  r = await designer(exe, fileBase, ['/CheckConfig', '-ConfigLogIntegrity', '-IncorrectReferences', '-ThinClient', '-WebClient', '-Server'], onData);
  cleanupDir(tmpBase);
  if (onData) onData(r.code === 0 ? '✓ Валидация пройдена\n' : '✖ Валидация с ошибками (см. лог)\n', r.code === 0 ? 'ok' : 'stderr');
  return r;
}

module.exports = {
  dumpConfigToFiles, loadConfigFromFiles, dumpCfg, loadCfg, updateDBCfg, v8unpack,
  startBase, probeLock, dumpIB, pushExtension, buildCfFromXml, validateXml,
};
