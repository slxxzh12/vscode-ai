import { DEFAULT_MESSAGES, type MarkdownLocale, type MarkdownMessages } from './messages';

export type { MarkdownLocale, MarkdownMessages } from './messages';
export { DEFAULT_MESSAGES } from './messages';

export function resolveMessages(
  locale: MarkdownLocale = 'zh-CN',
  overrides?: Partial<MarkdownMessages>,
): MarkdownMessages {
  return { ...(DEFAULT_MESSAGES[locale] || DEFAULT_MESSAGES.en), ...(overrides || {}) };
}

export function translate(
  messages: MarkdownMessages,
  key: keyof MarkdownMessages,
  params: Record<string, string> = {},
): string {
  const template = messages[key] || DEFAULT_MESSAGES.en[key] || String(key);
  return template.replace(/\{(\w+)\}/g, (_, name) => (name in params ? params[name] : `{${name}}`));
}
