import { describe, it, expect } from 'vitest';
import { isOnline, fmtNum, machineLabel, machineFullLabel, mergeMachines, ONLINE_WINDOW_MS } from './usagePeers';

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

  it('machineLabel：用户名 → 员工号 → machineId 依次回退', () => {
    expect(machineLabel({ machineId: 'm', employeeId: 'E1', username: 'u' } as any)).toBe('u');
    expect(machineLabel({ machineId: 'm', employeeId: 'E1' } as any)).toBe('E1');
    expect(machineLabel({ machineId: 'm' } as any)).toBe('m');
  });

  it('machineFullLabel：用户名@host:port（缺失用 - 占位）', () => {
    expect(machineFullLabel({ machineId: 'm', username: 'u', host: '10.0.0.1', port: 22222 } as any)).toBe('u@10.0.0.1:22222');
    expect(machineFullLabel({ machineId: 'm', username: 'u' } as any)).toBe('u@-:-');
    expect(machineFullLabel({ machineId: 'm' } as any)).toBe('m@-:-');
  });

  it('mergeMachines：上报过的机器 inGroup=false', () => {
    const rows = mergeMachines({ m1: mk({ machineId: 'm1', messages: 10 }) }, []);
    expect(rows.length).toBe(1);
    expect(rows[0].machineId).toBe('m1');
    expect(rows[0].inGroup).toBe(false);
    expect(rows[0].messages).toBe(10);
  });

  it('mergeMachines：群成员即使没上报也有行（inGroup=true 且字段缺失）', () => {
    const rows = mergeMachines({}, [mk({ machineId: 'm2', username: 'u2' })]);
    expect(rows.length).toBe(1);
    expect(rows[0].machineId).toBe('m2');
    expect(rows[0].inGroup).toBe(true);
    expect(rows[0].messages).toBeUndefined();
    expect(fmtNum(rows[0].messages)).toBe('-');
  });

  it('mergeMachines：同一机器（成员+已上报）只出现一行且 inGroup=true', () => {
    const rows = mergeMachines(
      { m3: mk({ machineId: 'm3', messages: 7 }) },
      [mk({ machineId: 'm3', username: 'u3' })],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].inGroup).toBe(true);
    expect(rows[0].messages).toBe(7);
    expect(rows[0].username).toBe('u3');
  });

  it('mergeMachines：成员与上报都为空时返回空数组', () => {
    expect(mergeMachines({}, [])).toEqual([]);
    expect(mergeMachines(undefined as any, undefined as any)).toEqual([]);
  });
});
