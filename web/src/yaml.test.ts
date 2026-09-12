import { describe, it, expect } from 'vitest';
import { parseYamlDoc, serializeYamlDoc, yamlTree } from './yaml';

const SAMPLE = [
  '# top comment',
  'name: demo',
  'count: 3',
  'on: true',
  'tags:',
  '  - a',
  '  - b',
  'nested:',
  '  k: v',
  '',
].join('\n');

describe('parseYamlDoc / serializeYamlDoc', () => {
  it('解析合法 YAML 并保留注释', () => {
    const { doc, error } = parseYamlDoc(SAMPLE);
    expect(error).toBe('');
    expect(doc).not.toBeNull();
    expect(serializeYamlDoc(doc!)).toContain('# top comment');
  });
  it('解析非法 YAML 返回 error', () => {
    const { doc, error } = parseYamlDoc('a: [1, 2');
    expect(doc).toBeNull();
    expect(error.length).toBeGreaterThan(0);
  });
});

describe('yamlTree', () => {
  it('构建映射/数组/标量节点', () => {
    const { doc } = parseYamlDoc(SAMPLE);
    const tree = yamlTree(doc!);
    const byKey = Object.fromEntries(tree.map((n) => [n.key, n]));
    expect(byKey.name.kind).toBe('scalar');
    expect(byKey.name.value).toBe('demo');
    expect(byKey.count.valueType).toBe('number');
    expect(byKey.on.valueType).toBe('boolean');
    expect(byKey.tags.kind).toBe('seq');
    expect(byKey.tags.children.map((c) => c.value)).toEqual(['a', 'b']);
    expect(byKey.nested.kind).toBe('map');
    expect(byKey.nested.children[0].key).toBe('k');
  });
});
