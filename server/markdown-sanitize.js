import sanitizeHtml from 'sanitize-html';
import { sanitizeCssValue } from '@devflow/shared/markdown-css';

const SVG_TAGS = [
  'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
  'text', 'tspan', 'defs', 'linearGradient', 'lineargradient', 'radialGradient',
  'radialgradient', 'stop', 'use', 'symbol', 'clipPath', 'clippath', 'mask',
  'pattern', 'title', 'desc',
];
const SVG_ATTRS = [
  'xmlns', 'viewBox', 'viewbox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'fill', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity',
  'stroke-opacity', 'font-size', 'text-anchor', 'preserveAspectRatio',
  'preserveaspectratio', 'id', 'gradientUnits', 'gradientunits', 'offset',
  'stop-color', 'stop-opacity', 'href',
];

const forbidden = new Set([
  'style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea',
  'button', 'select', 'option', 'link', 'meta', 'base',
]);
// sanitize-html 的默认白名单不含 img（也不含 svg），这里显式补回 Markdown 常用标签。
const allowedTags = sanitizeHtml.defaults.allowedTags
  .filter((t) => !forbidden.has(t))
  .concat(['img'], SVG_TAGS);
const allowedAttributes = { ...sanitizeHtml.defaults.allowedAttributes };
allowedAttributes['*'] = [...(allowedAttributes['*'] || []), 'class', 'id', 'style', 'title'];
for (const tag of SVG_TAGS) {
  allowedAttributes[tag] = [...(allowedAttributes[tag] || []), ...SVG_ATTRS];
}

export function sanitizeMarkdownHtml(html) {
  const clean = sanitizeHtml(String(html || ''), {
    allowedTags,
    allowedAttributes,
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    allowedSchemesAppliedToAttributes: ['href', 'src', 'xlink:href'],
    disallowedTagsMode: 'discard',
    parser: { lowerCaseAttributeNames: false },
  });
  return clean.replace(
    /style="([^"]*)"/g,
    (_m, v) => `style="${sanitizeCssValue(v).replace(/"/g, '&quot;')}"`,
  );
}
