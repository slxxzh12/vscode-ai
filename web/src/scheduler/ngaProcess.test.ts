import { describe, it, expect } from 'vitest';
import { formatNgaEvents } from './ngaProcess';

describe('formatNgaEvents', () => {
  it('把 JSON 事件转成可读过程', () => {
    const text = [
      '{"type":"step_start","part":{}}',
      '{"type":"text","part":{"text":"开始执行"}}',
      '{"type":"tool_use","part":{"title":"Inspect files"}}',
      '{"type":"step_finish","part":{}}',
    ].join('\n');
    expect(formatNgaEvents(text)).toBe('— step start —\n开始执行\n> Inspect files\n— step finish —');
  });

  it('保留普通文本并格式化错误', () => {
    expect(formatNgaEvents('plain line\n{"type":"error","error":{"data":{"message":"boom"}}}'))
      .toBe('plain line\nERROR: boom');
  });
});
