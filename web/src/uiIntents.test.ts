import { describe, it, expect, beforeEach } from 'vitest';
import {
  pendingTool, pendingStartAgent,
  requestTool, clearPendingTool,
  requestStartAgent, clearPendingStartAgent,
} from './uiIntents';

beforeEach(() => { clearPendingTool(); clearPendingStartAgent(); });

describe('uiIntents', () => {
  it('requestTool 置位并可清除', () => {
    expect(pendingTool.value).toBeNull();
    requestTool('yaml');
    expect(pendingTool.value).toBe('yaml');
    clearPendingTool();
    expect(pendingTool.value).toBeNull();
  });

  it('requestStartAgent 置位并可清除', () => {
    expect(pendingStartAgent.value).toBe(false);
    requestStartAgent();
    expect(pendingStartAgent.value).toBe(true);
    clearPendingStartAgent();
    expect(pendingStartAgent.value).toBe(false);
  });
});
