import { enhanceElementMarkdown, disposeElementMarkdown } from '@devflow/markdown-viewer';
import { locale, t } from '../i18n';

export function disposeMarkdown(container: HTMLElement): void {
  disposeElementMarkdown(container);
}

export async function enhanceMarkdown(
  container: HTMLElement,
  opts: { readAsset?: (rel: string) => Promise<string> } = {},
): Promise<void> {
  await enhanceElementMarkdown(container, {
    locale: locale.value === 'en' ? 'en' : 'zh-CN',
    theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
    readAsset: opts.readAsset,
    messages: {
      'markdown.mermaid_error': t('markdown.mermaid_error', { msg: '{msg}' }),
      'markdown.data_error': t('markdown.data_error', { msg: '{msg}' }),
      'table.confirm': t('common.ok'),
    },
  });
}
