import { parseDocument, isMap, isSeq, isScalar, type Document } from 'yaml';

export type YamlValueType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

export interface YamlNode {
  path: Array<string | number>;
  key: string;
  kind: 'map' | 'seq' | 'scalar';
  valueType: YamlValueType;
  value?: string;
  children: YamlNode[];
}

export function parseYamlDoc(text: string): { doc: Document | null; error: string } {
  try {
    const doc = parseDocument(text);
    if (doc.errors && doc.errors.length) return { doc: null, error: String(doc.errors[0].message || doc.errors[0]) };
    return { doc, error: '' };
  } catch (e: any) {
    return { doc: null, error: String(e?.message || e) };
  }
}

export function serializeYamlDoc(doc: Document): string {
  return String(doc);
}

function keyOf(k: unknown): string {
  if (isScalar(k)) return String(k.value ?? '');
  return String(k ?? '');
}

function scalarType(v: unknown): YamlValueType {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'string';
}

function nodeFor(n: unknown, path: Array<string | number>, key: string): YamlNode {
  if (isMap(n)) {
    const children = (n.items as any[]).map((p) => nodeFor(p.value, [...path, keyOf(p.key)], keyOf(p.key)));
    return { path, key, kind: 'map', valueType: 'object', children };
  }
  if (isSeq(n)) {
    const children = (n.items as any[]).map((it, i) => nodeFor(it, [...path, i], String(i)));
    return { path, key, kind: 'seq', valueType: 'array', children };
  }
  const v = isScalar(n) ? (n.value ?? null) : n;
  return { path, key, kind: 'scalar', valueType: scalarType(v), value: v === null ? 'null' : String(v), children: [] };
}

export function yamlTree(doc: Document): YamlNode[] {
  const c = doc.contents;
  if (!c) return [];
  if (isMap(c)) return (c.items as any[]).map((p) => nodeFor(p.value, [keyOf(p.key)], keyOf(p.key)));
  if (isSeq(c)) return (c.items as any[]).map((it, i) => nodeFor(it, [i], String(i)));
  return [nodeFor(c, [], '')];
}

export function setScalar(doc: Document, path: Array<string | number>, raw: string, valueType: YamlValueType): void {
  let v: unknown = raw;
  if (valueType === 'number') v = Number(raw);
  else if (valueType === 'boolean') v = raw === 'true';
  else if (valueType === 'null') v = null;
  doc.setIn(path, v);
}

export function addKey(doc: Document, mapPath: Array<string | number>, key: string, value: unknown = ''): void {
  doc.setIn([...mapPath, key], value);
}

export function deleteAt(doc: Document, path: Array<string | number>): void {
  doc.deleteIn(path);
}

export function addSeqItem(doc: Document, seqPath: Array<string | number>, value: unknown = ''): void {
  doc.addIn(seqPath, value);
}

export function moveAt(doc: Document, parentPath: Array<string | number>, index: number, dir: number): void {
  const node = parentPath.length ? doc.getIn(parentPath, true) : doc.contents;
  if (!isSeq(node)) return;
  const items = node.items as any[];
  const j = index + dir;
  if (j < 0 || j >= items.length) return;
  const a = items[index];
  items[index] = items[j];
  items[j] = a;
}
