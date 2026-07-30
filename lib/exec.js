'use strict';
const { spawn } = require('child_process');

/**
 * Запуск процесса с потоковой отдачей вывода.
 * onData(chunk, stream) вызывается на каждый кусок stdout/stderr.
 * Возвращает Promise<{ code, stdout, stderr }>. Никогда не reject на ненулевой код —
 * код возвращается в результате, чтобы вызывающий сам решал.
 */
function run(cmd, args, opts = {}) {
  const { cwd, env, onData, input } = opts;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        windowsHide: true,
        shell: false,
      });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e && e.message || e) });
      return;
    }

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d) => { stdout += d; if (onData) onData(d, 'stdout'); });
    }
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (d) => { stderr += d; if (onData) onData(d, 'stderr'); });
    }
    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
    child.on('error', (err) => {
      const msg = String(err && err.message || err);
      if (onData) onData(msg + '\n', 'stderr');
      resolve({ code: -1, stdout, stderr: stderr + msg });
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

module.exports = { run };
