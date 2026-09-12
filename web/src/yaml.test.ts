import { describe, it, expect } from 'vitest';
import { parseYamlDoc, serializeYamlDoc, yamlTree, setScalar, addKey, deleteAt, addSeqItem, moveAt } from './yaml';

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

const BASE = ['# keep me', 'a: 1', 'b:', '  - x', '  - y', ''].join('\n');

describe('YAML 编辑操作', () => {
  it('setScalar 改值并保留注释', () => {
    const { doc } = parseYamlDoc(BASE);
    setScalar(doc!, ['a'], '5', 'number');
    const out = serializeYamlDoc(doc!);
    expect(out).toContain('a: 5');
    expect(out).toContain('# keep me');
  });
  it('addKey 新增键', () => {
    const { doc } = parseYamlDoc(BASE);
    addKey(doc!, [], 'c', 'hi');
    expect(serializeYamlDoc(doc!)).toContain('c: hi');
  });
  it('deleteAt 删除键', () => {
    const { doc } = parseYamlDoc(BASE);
    deleteAt(doc!, ['a']);
    expect(serializeYamlDoc(doc!).includes('a: 1')).toBe(false);
  });
  it('addSeqItem 追加数组元素', () => {
    const { doc } = parseYamlDoc(BASE);
    addSeqItem(doc!, ['b'], 'z');
    const tree = yamlTree(doc!);
    const b = tree.find((n) => n.key === 'b')!;
    expect(b.children.map((c) => c.value)).toEqual(['x', 'y', 'z']);
  });
  it('moveAt 交换数组元素', () => {
    const { doc } = parseYamlDoc(BASE);
    moveAt(doc!, ['b'], 0, 1);
    const tree = yamlTree(doc!);
    const b = tree.find((n) => n.key === 'b')!;
    expect(b.children.map((c) => c.value)).toEqual(['y', 'x']);
  });
});
