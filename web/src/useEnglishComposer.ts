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

async function defaultTranslate(text: string): Promise<string> {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(j.message || j.error || `HTTP ${res.status}`) as Error & { code?: string };
    err.code = j.error;
    throw err;
  }
  return j.text || '';
}

export interface EnglishComposerDeps {
  translate?: (text: string) => Promise<string>;
  getActiveSessionId?: () => string | null;
  send?: (text: string, sessionId: string | null) => void;
  recordHistory?: (text: string, sessionId: string | null) => void;
  onError?: (key: string, params?: Record<string, unknown>) => void;
  onSent?: () => void;
}

export function useEnglishComposer(deps: EnglishComposerDeps = {}) {
  const translate = deps.translate || defaultTranslate;
  const getActiveSessionId = deps.getActiveSessionId || (() => null);
  const send = deps.send || (() => { /* noop */ });
  const recordHistory = deps.recordHistory || (() => { /* noop */ });
  const onError = deps.onError || ((key: string, params?: Record<string, unknown>) => alert(t(key, params)));
  const onSent = deps.onSent || (() => { /* noop */ });

  const translateMode = ref(false);
  const source = ref('');
  const translated = ref('');
  const translating = ref(false);
  const autoSend = ref(true);
  const countdown = ref<number | null>(null);

  let settingTranslated = false;
  let pendingSid: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  // ����д�����ģ����������༭����������ʱ��
  function setTranslated(v: string) {
    settingTranslated = true;
    translated.value = v;
    void nextTick(() => { settingTranslated = false; });
  }

  function disarm() {
    if (timer) { clearInterval(timer); timer = null; }
    countdown.value = null;
    pendingSid = null;
  }

  function startTick() {
    if (timer) clearInterval(timer);
    countdown.value = COUNTDOWN_SECONDS;
    timer = setInterval(() => {
      countdown.value = (countdown.value ?? 1) - 1;
      if ((countdown.value ?? 0) <= 0) firePending();
    }, COUNTDOWN_TICK_MS);
  }

  function arm() {
    if (!autoSend.value) return;
    if (!translated.value.trim()) return;
    if (timer) return;                       // ���ڵ���ʱ������ restartCountdown
    pendingSid = getActiveSessionId();
    startTick();
  }

  function restartCountdown() {
    if (timer) startTick();                  // ���� pendingSid������������ʱ�ĻỰ��
  }

  function doSend(text: string, sid: string | null) {
    disarm();
    send(text, sid);
    recordHistory(source.value.trim() || text, sid);
    source.value = '';
    setTranslated('');
    onSent();
  }

  // 清空按钮：两栏一起清，并立刻取消倒计时（不等 watcher）
  function clear() {
    source.value = '';
    setTranslated('');
    disarm();
  }

  function firePending() {
    const sid = pendingSid;
    const text = translated.value.trim();
    disarm();
    if (!text) return;
    doSend(text, sid);
  }

  async function translateNow(): Promise<boolean> {
    const text = source.value.trim();
    if (!text) return false;
    translating.value = true;
    try {
      const out = isAsciiOnly(text) ? text : await translate(text);
      setTranslated(out);
      await nextTick();                      // 先让左栏 watcher 的 disarm 落地，再 arm，避免被它取消
      arm();
      return true;
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      const key = (code && TRANSLATE_ERR_KEY[code]) || 'et.failed';
      onError(key, key === 'et.failed' ? { msg: (e as Error)?.message || String(e) } : undefined);
      return false;
    } finally {
      translating.value = false;
    }
  }

  async function sendAction(): Promise<void> {
    const cur = translated.value.trim();
    if (cur) { doSend(cur, pendingSid ?? getActiveSessionId()); return; }
    if (source.value.trim()) {
      if (!(await translateNow())) return;
      doSend(translated.value.trim() || 'ok', getActiveSessionId());
      return;
    }
    doSend('ok', getActiveSessionId());
  }

  async function onLeftEnter(): Promise<void> {
    if (source.value.trim()) { await translateNow(); return; }
    doSend('ok', getActiveSessionId());
  }

  function toggleTranslate() { translateMode.value = !translateMode.value; }

  watch(source, () => { disarm(); });
  watch(translated, () => {
    if (settingTranslated) return;
    if (!translated.value.trim()) { disarm(); return; }
    restartCountdown();
  });
  watch(autoSend, (v) => { if (v) arm(); else disarm(); });

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  watch(autoSend, () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void fetch('/api/composer/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSend: autoSend.value }),
      }).catch(() => { /* ignore */ });
    }, SAVE_DEBOUNCE_MS);
  });

  let loaded = false;
  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const res = await fetch('/api/composer/prefs');
      if (res.ok) autoSend.value = mergeComposerPrefs(await res.json());
    } catch { /* ��Ĭ��ֵ */ }
  }

  return {
    translateMode, source, translated, translating, autoSend, countdown,
    load, toggleTranslate, translateNow, sendAction, onLeftEnter, clear,
  };
}
