import { ref } from 'vue';
import type { ToolId } from './tools/catalog';

// 跨组件/跨挂载的「待处理意图」：组件可能因 rail 切换被卸载，一次性事件会丢，故用模块级标记。
export const pendingTool = ref<ToolId | null>(null);
export const pendingToolTab = ref<ToolId | null>(null);
export type ProxyTab = 'ai' | 'nginx' | 'static' | 'llm';
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

// 在中心区以「执行页签」打开 AI 工具运行（TerminalView 消费）
export const pendingRun = ref<{ runId: string; label: string } | null>(null);
export function requestRunTab(runId: string, label: string) { pendingRun.value = { runId, label }; }
export function clearPendingRun() { pendingRun.value = null; }

// 敏感信息扫描 → 用提示词启动 Agent：App 负责把目录加成项目并选中，TerminalView 负责新开 Agent 并发送提示词
export const pendingAgentRun = ref<{ dir: string; prompt: string } | null>(null);
export function requestAgentRun(dir: string, prompt: string) { pendingAgentRun.value = { dir, prompt }; }
export function clearPendingAgentRun() { pendingAgentRun.value = null; }
export const pendingAgentPrompt = ref('');
export function requestAgentPrompt(text: string) { pendingAgentPrompt.value = text; }
export function clearPendingAgentPrompt() { pendingAgentPrompt.value = ''; }
