import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translate, normalizeLocale, LOCALES, DEFAULT_LOCALE } from '@devflow/shared/i18n';

test('normalizeLocale 归一化', () => {
  assert.equal(normalizeLocale('zh-CN'), 'zh-CN');
  assert.equal(normalizeLocale('zh-TW'), 'zh-CN');
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('fr'), DEFAULT_LOCALE);
  assert.equal(normalizeLocale(null), DEFAULT_LOCALE);
  assert.equal(normalizeLocale(undefined), DEFAULT_LOCALE);
});

test('LOCALES 与默认语言', () => {
  assert.deepEqual([...LOCALES], ['zh-CN', 'en']);
  assert.equal(DEFAULT_LOCALE, 'zh-CN');
});

test('translate 中英词条与 {param} 插值', () => {
  assert.equal(translate('zh-CN', 'nav.explorer'), '目录');
  assert.equal(translate('en', 'nav.explorer'), 'Explorer');
  assert.equal(translate('zh-CN', 'time.today', { hm: '09:30' }), '今天 09:30');
  assert.equal(translate('en', 'time.today', { hm: '09:30' }), 'Today 09:30');
});

test('未知 key 回退为 key 本身', () => {
  assert.equal(translate('zh-CN', 'nope.missing'), 'nope.missing');
  assert.equal(translate('en', 'nope.missing'), 'nope.missing');
});
