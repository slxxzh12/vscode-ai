import DOMPurify from 'dompurify';
import { sanitizeCssValue } from './markdown-css.js';

const PURIFY_OPTS = {
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'button', 'select', 'option', 'math', 'link', 'meta', 'base'],
  FORBID_ATTR: ['srcdoc'],
  ADD_ATTR: ['target'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

const purify = (() => {
  const factory = DOMPurify as unknown;
  if (typeof factory === 'function' && typeof window !== 'undefined') {
    return (factory as (w: Window) => typeof DOMPurify)(window);
  }
  return DOMPurify;
})();

export function sanitizeHtml(html: string): string {
  return purify.sanitize(html, PURIFY_OPTS);
}

export function sanitizeInlineStyles(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll('[style]'))) {
    const value = el.getAttribute('style') || '';
    el.setAttribute('style', sanitizeCssValue(value));
  }
}
