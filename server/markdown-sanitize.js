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
// 表格族标签的布局属性（合并单元格、嵌套表格需要 rowspan/colspan 等）
const TABLE_ATTRS = {
  table: ['border', 'cellpadding', 'cellspacing', 'width', 'height', 'align', 'summary', 'frame', 'rules'],
  caption: ['align'],
  colgroup: ['span', 'width', 'align', 'valign'],
  col: ['span', 'width', 'align', 'valign'],
  thead: ['align', 'valign'],
  tbody: ['align', 'valign'],
  tfoot: ['align', 'valign'],
  tr: ['align', 'valign'],
  th: ['rowspan', 'colspan', 'width', 'height', 'align', 'valign', 'scope', 'abbr', 'axis', 'headers'],
  td: ['rowspan', 'colspan', 'width', 'height', 'align', 'valign', 'abbr', 'axis', 'headers'],
};
// sanitize-html 的默认白名单不含 img（也不含 svg），这里显式补回 Markdown 常用标签。
const allowedTags = sanitizeHtml.defaults.allowedTags
  .filter((t) => !forbidden.has(t))
  .concat(['img'], SVG_TAGS);
const allowedAttributes = { ...sanitizeHtml.defaults.allowedAttributes };
allowedAttributes['*'] = [...(allowedAttributes['*'] || []), 'class', 'id', 'style', 'title'];
for (const [tag, attrs] of Object.entries(TABLE_ATTRS)) {
  allowedAttributes[tag] = [...(allowedAttributes[tag] || []), ...attrs];
}
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
