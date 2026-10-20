import { ref } from 'vue';
import type { ToolId } from './tools/catalog';

// 跨组件/跨挂载的「待处理意图」：组件可能因 rail 切换被卸载，一次性事件会丢，故用模块级标记。
export const pendingTool = ref<ToolId | null>(null);
export const pendingToolTab = ref<ToolId | null>(null);
export type ProxyTab = 'nginx' | 'llm';
export const pendingProxyTab = ref<ProxyTab | null>(null);
export const pendingStartAgent = ref(false);

export function requestTool(id: ToolId) { pendingTool.value = id; }
export function clearPendingTool() { pendingTool.value = null; }

// 在主区以「工具页签」打开（App 监听：切到 explorer + openTool）
export function requestToolTab(id: ToolId) { pendingToolTab.value = id; }
export function clearPendingToolTab() { pendingToolTab.value = null; }

// 打开合并后的「代理」页面并选中子页签（App 切 rail，ProxyHubView 消费）
export function requestProxyTab(tab: ProxyTab) { pendingProxyTab.value = tab; }
export function clearPendingProxyTab() { pendingProxyTab.value = null; }

export function requestStartAgent() { pendingStartAgent.value = true; }
export function clearPendingStartAgent() { pendingStartAgent.value = false; }
