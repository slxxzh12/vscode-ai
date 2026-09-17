import { ref, watch, nextTick } from 'vue';
import { t } from './i18n';

export const COUNTDOWN_SECONDS = 3;
const COUNTDOWN_TICK_MS = 1000;
const SAVE_DEBOUNCE_MS = 500;

const TRANSLATE_ERR_KEY: Record<string, string> = {
  'empty-input': 'et.empty',
  'too-long': 'et.too_long',
  'no-provider': 'et.no_provider',
  'no-key': 'et.no_key',
  'image-too-large': 'et.image_too_large',
  'too-many-images': 'et.too_many_images',
  timeout: 'et.timeout',
};

// 全 ASCII（字母/数字/空白/ASCII 标点）无需翻译
export function isAsciiOnly(text: string): boolean {
  return !/[^\x00-\x7F]/.test(text);
}

// 服务端缺键/类型不符 → 回退默认值 true
export function mergeComposerPrefs(saved: unknown, dflt = true): boolean {
  const s = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, unknown> : {};
  return typeof s.autoSend === 'boolean' ? s.autoSend : dflt;
}
