import { describe, it, expect } from 'vitest';
import { fileIcon } from './fileIcon';

describe('fileIcon', () => {
  it('按扩展名给图标', () => {
    const cases: Array<[string, string]> = [
      ['a.ts', '🧩'], ['a.html', '🌐'], ['a.yml', '📐'], ['a.http', '⇀'],
      ['a.exe', '⬛'], ['a.png', '🖼️'], ['a.zip', '🗜️'], ['a.docx', '📝'], ['a.unknown', '📄'], ['noext', '📄'],
    ];
    for (const [name, icon] of cases) expect(fileIcon(name)).toBe(icon);
  });
});
