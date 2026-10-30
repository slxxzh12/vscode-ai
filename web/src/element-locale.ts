import { computed } from 'vue';
import en from 'element-plus/es/locale/lang/en';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { locale, t } from './i18n';

// Element Plus 中文把表格筛选的确认按钮叫「筛选」，这里统一成「确定」
function withConfirmText(base: typeof zhCn): typeof zhCn {
  return {
    ...base,
    el: {
      ...base.el,
      table: { ...base.el.table, confirmFilter: t('common.ok') },
    },
  };
}

export const elementLocale = computed(() =>
  locale.value === 'en' ? en : withConfirmText(zhCn),
);
