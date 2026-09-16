import { describe, it, expect } from 'vitest';
import { isOnline, fmtNum, sortPeers, usageCells, machineLabel, sortRows, nextSort, ONLINE_WINDOW_MS } from './usagePeers';

const mk = (o: any) => ({ machineId: 'm', username: 'u', host: 'h', port: 1, ...o });

describe('usagePeers', () => {
  it('isOnline：3 小时内算在线', () => {
    expect(ONLINE_WINDOW_MS).toBe(3 * 60 * 60 * 1000);
    expect(isOnline(1000, 1000 + ONLINE_WINDOW_MS - 1)).toBe(true);
    expect(isOnline(1000, 1000 + ONLINE_WINDOW_MS)).toBe(false);
    expect(isOnline(0, 500)).toBe(false);
  });
  it('fmtNum：千/百万缩写，缺失显示 -', () => {
    expect(fmtNum(undefined)).toBe('-');
    expect(fmtNum(999)).toBe('999');
    expect(fmtNum(1500)).toBe('1.5K');
    expect(fmtNum(2_000_000)).toBe('2.0M');
  });
  it('sortPeers：默认按 messages 降序（消息多的在前），缺失排最后', () => {
    const list = sortPeers({
      a: mk({ machineId: 'a', messages: 5, receivedAt: 30 }),
      b: mk({ machineId: 'b', messages: 50, receivedAt: 10 }),
      c: mk({ machineId: 'c', receivedAt: 20 }),
    });
    expect(list.map((p) => p.machineId)).toEqual(['b', 'a', 'c']);
  });
  it('machineLabel：员工号 → 用户名 → machineId 依次回退', () => {
    expect(machineLabel({ machineId: 'm', employeeId: 'E1', username: 'u' } as any)).toBe('E1');
    expect(machineLabel({ machineId: 'm', username: 'u' } as any)).toBe('u');
    expect(machineLabel({ machineId: 'm' } as any)).toBe('m');
  });
  it('sortRows：数值列可正序/倒序，缺失值总在最后', () => {
    const rows = [
      mk({ machineId: 'a', input: 300 }),
      mk({ machineId: 'b', input: 100 }),
      mk({ machineId: 'c' }),
    ];
    expect(sortRows(rows, 'input', 'asc').map((r) => r.machineId)).toEqual(['b', 'a', 'c']);
    expect(sortRows(rows, 'input', 'desc').map((r) => r.machineId)).toEqual(['a', 'b', 'c']);
  });
  it('sortRows：machine 列按标签排序，同值以标签兜底稳定', () => {
    const rows = [
      mk({ machineId: 'm2', username: 'zz' }),
      mk({ machineId: 'm1', username: 'aa' }),
    ];
    expect(sortRows(rows, 'machine', 'asc').map((r) => r.machineId)).toEqual(['m1', 'm2']);
    expect(sortRows(rows, 'machine', 'desc').map((r) => r.machineId)).toEqual(['m2', 'm1']);
  });
  it('nextSort：同列点击切换方向；新数值列先降序，machine 列先升序', () => {
    expect(nextSort({ key: 'messages', dir: 'desc' }, 'messages')).toEqual({ key: 'messages', dir: 'asc' });
    expect(nextSort({ key: 'messages', dir: 'asc' }, 'messages')).toEqual({ key: 'messages', dir: 'desc' });
    expect(nextSort({ key: 'messages', dir: 'desc' }, 'input')).toEqual({ key: 'input', dir: 'desc' });
    expect(nextSort({ key: 'messages', dir: 'desc' }, 'machine')).toEqual({ key: 'machine', dir: 'asc' });
  });
  it('usageCells：给出 sessions/days/messages/input/output/totalCost 六列文本', () => {
    expect(usageCells(mk({ sessions: 3, days: 7, messages: 9, input: 1500, output: 20, totalCost: 1.5 })))
      .toEqual(['3', '7', '9', '1.5K', '20', '1.5']);
    expect(usageCells(mk({ error: 'boom' }))).toEqual(['-', '-', '-', '-', '-', '-']);
  });
});
