import { test, expect } from 'vitest';
import { fmtSize, groupDownloadFiles, installableOf, marketKindKey, MARKET_CLIENTS } from './marketApps';

test('fmtSize：B/KB/MB 分档与小数位', () => {
  expect(fmtSize(0)).toBe('0 B');
  expect(fmtSize(512)).toBe('512 B');
  expect(fmtSize(1024)).toBe('1.0 KB');
  expect(fmtSize(1536)).toBe('1.5 KB');
  expect(fmtSize(10 * 1024 * 1024)).toBe('10 MB');
});

test('installableOf / marketKindKey', () => {
  expect(installableOf({ kind: 'skill' })).toBe(true);
  expect(installableOf({ kind: 'file' })).toBe(false);
  expect(marketKindKey('skill')).toBe('market.kind.skill');
  expect(marketKindKey('workflow')).toBe('market.kind.workflow');
  expect(marketKindKey('weird')).toBe('market.kind.file');
});

test('groupDownloadFiles：skill 与其它分组，各自按 updatedAt 倒序、忽略坏项', () => {
  const g = groupDownloadFiles([
    { name: 'b.zip', kind: 'file', size: 1, updatedAt: 1 },
    { name: 'a.zip', kind: 'skill', size: 1, updatedAt: 2 },
    { name: 'c.zip', kind: 'skill', size: 1, updatedAt: 5 },
    null as unknown as { name: string; kind: string; size: number; updatedAt: number },
  ]);
  expect(g.skill.map((f) => f.name)).toEqual(['c.zip', 'a.zip']);
  expect(g.other.map((f) => f.name)).toEqual(['b.zip']);
  expect(groupDownloadFiles(undefined)).toEqual({ skill: [], other: [] });
});

test('MARKET_CLIENTS：含桌面端与手机端（手机端带二维码标记）', () => {
  expect(MARKET_CLIENTS.some((c) => c.id === 'win')).toBe(true);
  expect(MARKET_CLIENTS.some((c) => c.id === 'mac_arm')).toBe(true);
  expect(MARKET_CLIENTS.some((c) => c.qr)).toBe(true);
  expect(MARKET_CLIENTS.every((c) => c.labelKey.startsWith('market.client.'))).toBe(true);
});
