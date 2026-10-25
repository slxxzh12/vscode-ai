import { describe, expect, it } from 'vitest';
import { decodePromptBase64, parseSchedulerPromptFromSearch, parseSchedulerEditFromSearch } from './schedulerIntent';

function b64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

describe('schedulerIntent', () => {
  it('解码 UTF-8 base64 提示词', () => {
    expect(decodePromptBase64(b64('分析一下日志'))).toBe('分析一下日志');
  });

  it('解码 URL-safe base64', () => {
    const raw = b64('a+b/c?').replace(/\+/g, '-').replace(/\//g, '_');
    expect(decodePromptBase64(raw)).toBe('a+b/c?');
  });

  it('兼容未转义时 + 被解码成空格', () => {
    expect(decodePromptBase64('Pj4 ')).toBe('>>>');
  });

  it('不带 run/hideInput 参数时只预填', () => {
    expect(parseSchedulerPromptFromSearch(`?aiPrompt=${encodeURIComponent(b64('hello'))}`))
      .toEqual({ prompt: 'hello', run: false, hideInput: false });
  });

  it('run=1 立即执行，hideInput=1 隐藏左侧输入区', () => {
    expect(parseSchedulerPromptFromSearch(`?prompt=${encodeURIComponent(b64('hello'))}&run=1&hideInput=1`))
      .toEqual({ prompt: 'hello', run: true, hideInput: true });
  });

  it('缺少提示词或解码失败返回 null', () => {
    expect(parseSchedulerPromptFromSearch('?run=1')).toBeNull();
    expect(parseSchedulerPromptFromSearch('?prompt=%%%')).toBeNull();
    expect(parseSchedulerPromptFromSearch(`?prompt=${encodeURIComponent(b64('   '))}`)).toBeNull();
  });

  it('解析编辑意图：原文 > 提示词 ID > Hash，只取一个', () => {
    const edit = parseSchedulerEditFromSearch(`?editTask=t1&promptId=3&promptHash=h3&prompt=${encodeURIComponent(b64('原文'))}`);
    expect(edit).toEqual({ taskId: 't1', promptId: '', promptHash: '', prompt: '原文' });

    const byId = parseSchedulerEditFromSearch('?editTask=t1&promptId=3&promptHash=h3');
    expect(byId).toEqual({ taskId: 't1', promptId: '3', promptHash: '', prompt: '' });

    const byHash = parseSchedulerEditFromSearch('?editTask=t1&promptHash=h3');
    expect(byHash).toEqual({ taskId: 't1', promptId: '', promptHash: 'h3', prompt: '' });

    expect(parseSchedulerEditFromSearch('?prompt=abc')).toBeNull();
  });
});
