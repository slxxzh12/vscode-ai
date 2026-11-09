import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMarkdownViewerAsset, markdownViewerDistDir } from '../markdown-viewer-assets.js';

test('matches /_mdv paths', () => {
  assert.equal(isMarkdownViewerAsset('/_mdv'), true);
  assert.equal(isMarkdownViewerAsset('/_mdv/index.js'), true);
  assert.equal(isMarkdownViewerAsset('/mdv/index.js'), false);
});

test('resolves the package standalone dist', () => {
  assert.match(markdownViewerDistDir(), /markdown-viewer[\\/]+dist[\\/]+standalone$/);
});
