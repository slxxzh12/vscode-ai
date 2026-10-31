import { describe, it, expect, afterEach } from 'vitest';
import { locale } from './i18n';
import { elementLocale } from './element-locale';

afterEach(() => { locale.value = 'zh-CN'; });

describe('elementLocale', () => {
  it('中文时表格筛选的确认按钮显示「确定」', () => {
    locale.value = 'zh-CN';
    expect(elementLocale.value.el.table.confirmFilter).toBe('确定');
  });

  it('英文时跟随英文', () => {
    locale.value = 'en';
    expect(elementLocale.value.el.table.confirmFilter).toBe('Confirm');
  });
});
