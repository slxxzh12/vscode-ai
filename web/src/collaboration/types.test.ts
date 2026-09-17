import { describe, it, expect } from 'vitest';
import { EMPTY_SNAPSHOT } from './types';

describe('EMPTY_SNAPSHOT', () => {
  it('为空快照骨架，可安全展开使用', () => {
    expect(EMPTY_SNAPSHOT.identity).toMatchObject({ machineId: '', username: '', port: 0 });
    expect(EMPTY_SNAPSHOT.group).toBeNull();
    expect(EMPTY_SNAPSHOT.groups).toEqual([]);
    expect(EMPTY_SNAPSHOT.heartbeats).toEqual({});
    expect(EMPTY_SNAPSHOT.skillsInbox).toEqual([]);
    expect(EMPTY_SNAPSHOT.outbox).toEqual([]);
    expect(EMPTY_SNAPSHOT.groupSkills).toEqual([]);
  });
});
