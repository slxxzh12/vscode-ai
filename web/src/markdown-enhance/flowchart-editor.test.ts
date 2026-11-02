// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

// X6 的包在 Node 下是 CJS/ESM 混用，测试里用轻量桩避免真实加载。
vi.mock('@antv/x6', () => ({ Graph: class {}, Shape: { Edge: class {} } }));

import { openFlowchartEditor } from '@devflow/shared/markdown-flowchart-editor';

describe('openFlowchartEditor', () => {
  it('无法解析的 Mermaid 返回 null，不创建浮层', () => {
    expect(openFlowchartEditor({ code: 'not a flowchart' })).toBeNull();
    expect(document.querySelector('.df-flowedit')).toBeNull();
  });
});
