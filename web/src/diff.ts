// 文本对比：Myers 行级 diff + 行内词级 diff，零依赖。

export type DiffOpType = 'equal' | 'del' | 'ins';

export interface DiffOp<T> {
  type: DiffOpType;
  item: T;
}

// 通用 Myers O(ND) 差分（返回最短编辑脚本，元素级相等由 eq 判定）
export function myers<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): DiffOp<T>[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;

  // 公共前缀/后缀先裁掉，缩小核心差分区间
  let start = 0;
  while (start < n && start < m && eq(a[start], b[start])) start++;
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && eq(a[endA - 1], b[endB - 1])) {
    endA--;
    endB--;
  }

  const prefix: DiffOp<T>[] = [];
  for (let i = 0; i < start; i++) prefix.push({ type: 'equal', item: a[i] });
  const suffix: DiffOp<T>[] = [];
  for (let i = endA; i < n; i++) suffix.push({ type: 'equal', item: a[i] });

  const mid = myersCore(a.slice(start, endA), b.slice(start, endB), eq);
  return [...prefix, ...mid, ...suffix];
}

function myersCore<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): DiffOp<T>[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((item) => ({ type: 'ins' as const, item }));
  if (m === 0) return a.map((item) => ({ type: 'del' as const, item }));

  const max = n + m;
  // v[k] = 在对角线 k 上可达的最远 x（y = x - k）
  const v = new Map<number, number>();
  v.set(1, 0);
  const trace: Array<Map<number, number>> = [];

  let dEnd = -1;
  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) {
        x = v.get(k + 1) ?? 0; // 向下（插入）
      } else {
        x = (v.get(k - 1) ?? 0) + 1; // 向右（删除）
      }
      let y = x - k;
      while (x < n && y < m && eq(a[x], b[y])) {
        x++;
        y++;
      }
      v.set(k, x);
      if (x >= n && y >= m) {
        dEnd = d;
        break outer;
      }
    }
  }

  const ops: DiffOp<T>[] = [];
  let x = n;
  let y = m;
  for (let d = dEnd; d >= 0; d--) {
    const vv = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && (vv.get(k - 1) ?? -1) < (vv.get(k + 1) ?? -1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vv.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', item: a[x - 1] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        ops.push({ type: 'ins', item: b[y - 1] });
        y--;
      } else {
        ops.push({ type: 'del', item: a[x - 1] });
        x--;
      }
    }
  }
  ops.reverse();
  return ops;
}

export interface DiffSpan {
  text: string;
  changed: boolean;
}

export interface DiffRow {
  kind: 'equal' | 'del' | 'ins' | 'change';
  left: DiffSpan[] | null;
  right: DiffSpan[] | null;
  leftLine: number | null;
  rightLine: number | null;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  const parts = text.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function tokenize(s: string): string[] {
  return s.split(/(\s+)/).filter((x) => x.length > 0);
}

function changeRow(aLine: string, bLine: string, ll: number, rl: number): DiffRow {
  const at = tokenize(aLine);
  const bt = tokenize(bLine);
  const ops = myers(at, bt, (x, y) => x === y);
  const left: DiffSpan[] = [];
  const right: DiffSpan[] = [];
  for (const op of ops) {
    if (op.type === 'equal') {
      left.push({ text: op.item, changed: false });
      right.push({ text: op.item, changed: false });
    } else if (op.type === 'del') {
      left.push({ text: op.item, changed: true });
    } else {
      right.push({ text: op.item, changed: true });
    }
  }
  return { kind: 'change', left, right, leftLine: ll, rightLine: rl };
}

export interface DiffResult {
  rows: DiffRow[];
  added: number;
  removed: number;
  changed: number;
}

export function diffText(aText: string, bText: string): DiffResult {
  const a = splitLines(aText);
  const b = splitLines(bText);
  const ops = myers(a, b, (x, y) => x === y);

  const rows: DiffRow[] = [];
  let leftLine = 0;
  let rightLine = 0;
  let i = 0;
  let added = 0;
  let removed = 0;
  let changed = 0;

  while (i < ops.length) {
    const op = ops[i];
    if (op.type === 'equal') {
      leftLine++;
      rightLine++;
      rows.push({
        kind: 'equal',
        left: [{ text: op.item, changed: false }],
        right: [{ text: op.item, changed: false }],
        leftLine,
        rightLine,
      });
      i++;
    } else {
      const dels: string[] = [];
      const inss: string[] = [];
      while (i < ops.length && ops[i].type !== 'equal') {
        if (ops[i].type === 'del') dels.push(ops[i].item);
        else inss.push(ops[i].item);
        i++;
      }
      const common = Math.min(dels.length, inss.length);
      for (let j = 0; j < common; j++) {
        leftLine++;
        rightLine++;
        changed++;
        rows.push(changeRow(dels[j], inss[j], leftLine, rightLine));
      }
      for (let j = common; j < dels.length; j++) {
        leftLine++;
        removed++;
        rows.push({ kind: 'del', left: [{ text: dels[j], changed: true }], right: null, leftLine, rightLine: null });
      }
      for (let j = common; j < inss.length; j++) {
        rightLine++;
        added++;
        rows.push({ kind: 'ins', left: null, right: [{ text: inss[j], changed: true }], leftLine: null, rightLine });
      }
    }
  }

  return { rows, added, removed, changed };
}
