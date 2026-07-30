'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Эвристическая проверка BSL по ключевым антипаттернам (не полноценный линтер).
 * files — список путей относительно repoPath. Возвращает массив находок.
 */
function lintFiles(repoPath, files) {
  const findings = [];
  for (const rel of files) {
    if (!/\.bsl$/i.test(rel)) continue;
    let text;
    try { text = fs.readFileSync(path.join(repoPath, rel), 'utf8'); } catch (_) { continue; }
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    let loopDepth = 0;
    let tranDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.replace(/\/\/.*$/, ''); // отрезаем строчный комментарий
      const ln = i + 1;

      // учёт вложенности циклов
      const isLoopEnd = /\bКонецЦикла\b/i.test(line);
      const isLoopStart = /\bЦикл\b/i.test(line) && !isLoopEnd;
      if (isLoopEnd) loopDepth = Math.max(0, loopDepth - 1);

      // 1. Запрос в цикле (критично)
      if (loopDepth > 0 && (/\bНовый\s+Запрос\b/i.test(line) || /\.\s*Выполнить\s*\(/i.test(line))) {
        push(findings, rel, ln, 'critical', 'query-in-loop',
          'Запрос/Выполнить() внутри цикла — вынесите запрос за цикл (пакет + временная таблица).', raw.trim());
      }
      // 2. Сообщить() как оповещение пользователя (высокий)
      if (/(^|[^.\wА-Яа-яЁё])Сообщить\s*\(/.test(line)) {
        push(findings, rel, ln, 'high', 'legacy-message',
          'Сообщить() — используйте ОбщегоНазначения.СообщитьПользователю() или порождение исключения.', raw.trim());
      }
      // 3. Прямой Запрос.Выполнить без промежуточной переменной результата (инфо) — только вне цикла
      if (loopDepth === 0 && /=\s*.*\.\s*Выполнить\s*\(\s*\)\s*\.\s*(Выбрать|Выгрузить)\s*\(/i.test(line)) {
        push(findings, rel, ln, 'info', 'no-intermediate-result',
          'Цепочка Выполнить().Выбрать() — заведите промежуточную переменную результата запроса.', raw.trim());
      }
      // 4. Транзакции: НачатьТранзакцию без Попытки рядом (эвристика, инфо)
      if (/\bНачатьТранзакцию\s*\(/i.test(line)) tranDepth++;
      if (/\bЗафиксироватьТранзакцию\s*\(/i.test(line)) tranDepth = Math.max(0, tranDepth - 1);

      if (isLoopStart) loopDepth++;
    }
  }
  // сортировка: critical -> high -> info
  const rank = { critical: 0, high: 1, info: 2 };
  findings.sort((a, b) => (rank[a.severity] - rank[b.severity]) || a.file.localeCompare(b.file));
  return findings;
}

function push(arr, file, line, severity, rule, message, code) {
  arr.push({ file, line, severity, rule, message, code });
}

module.exports = { lintFiles };
