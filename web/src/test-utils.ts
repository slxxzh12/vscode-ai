import { mount } from '@vue/test-utils';
import { t } from './i18n';

// 挂载组件并注入全局 $t（main.ts 里通过 app.config.globalProperties.$t 提供）。
export function mountC(component: unknown, options: any = {}) {
  const global = options.global || {};
  const config = global.config || {};
  const globalProperties = config.globalProperties || {};
  return mount(component as any, {
    ...options,
    global: {
      ...global,
      config: { ...config, globalProperties: { $t: t, ...globalProperties } },
    },
  });
}
