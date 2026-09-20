import { ref } from 'vue';
import type { ToolId } from './tools/catalog';

// 跨组件/跨挂载的「待处理意图」：组件可能因 rail 切换被卸载，一次性事件会丢，故用模块级标记。
export const pendingTool = ref<ToolId | null>(null);
export const pendingStartAgent = ref(false);

export function requestTool(id: ToolId) { pendingTool.value = id; }
export function clearPendingTool() { pendingTool.value = null; }

export function requestStartAgent() { pendingStartAgent.value = true; }
export function clearPendingStartAgent() { pendingStartAgent.value = false; }
