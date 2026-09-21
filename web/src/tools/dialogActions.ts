import type { InjectionKey } from 'vue';

// 小工具弹窗顶部标题行里的操作区：各工具把自己的操作栏 Teleport 到这里，
// 与弹窗标题同一行、靠右显示。
// 未在小工具弹窗内时（例如组件单测直接挂载工具），注入为空 → Teleport 降级为就地渲染。
export const DIALOG_ACTIONS_ID = 'mtdlg-actions';
export const DIALOG_ACTIONS_TARGET: InjectionKey<string> = Symbol('devflow.dialogActionsTarget');
