import { describe, it, expect, beforeEach } from 'vitest';
import {
  pendingTool, pendingToolTab, pendingStartAgent,
  requestTool, clearPendingTool,
  requestToolTab, clearPendingToolTab,
  requestStartAgent, clearPendingStartAgent,
} from './uiIntents';

beforeEach(() => { clearPendingTool(); clearPendingToolTab(); clearPendingStartAgent(); });

describe('uiIntents', () => {
  it('requestTool 置位并可清除', () => {
    expect(pendingTool.value).toBeNull();
    requestTool('yaml');
    expect(pendingTool.value).toBe('yaml');
    clearPendingTool();
    expect(pendingTool.value).toBeNull();
  });

  it('requestToolTab 置位并可清除', () => {
    expect(pendingToolTab.value).toBeNull();
    requestToolTab('notepad');
    expect(pendingToolTab.value).toBe('notepad');
    clearPendingToolTab();
    expect(pendingToolTab.value).toBeNull();
  });

  it('requestStartAgent 置位并可清除', () => {
    expect(pendingStartAgent.value).toBe(false);
    requestStartAgent();
    expect(pendingStartAgent.value).toBe(true);
    clearPendingStartAgent();
    expect(pendingStartAgent.value).toBe(false);
  });
});
