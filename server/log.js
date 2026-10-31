import { writeSync } from 'node:fs';
import { format } from 'node:util';

function writeLine(fd, text) {
  const line = `${text}\n`;
  try {
    writeSync(fd, line);
  } catch {
    try {
      (fd === 1 ? process.stdout : process.stderr).write(line);
    } catch {}
  }
}

export function createLogger(prefix = '') {
  const ts = () => new Date().toISOString();
  return {
    info: (...a) => writeLine(1, format(ts(), prefix, ...a)),
    warn: (...a) => writeLine(2, format(ts(), prefix, '[warn]', ...a)),
    error: (...a) => writeLine(2, format(ts(), prefix, '[error]', ...a)),
  };
}
