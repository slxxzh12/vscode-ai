import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import App from './App.vue';
import PhoneView from './remote-coder/PhoneView.vue';
import { isPhoneEntry } from './remote-coder/entry';
import './styles.css';
import { t } from './i18n';

// 远程登录后 302 会带一次性页面令牌 __df：用后即从地址栏抹掉（一次性，刷新即失效，需重新输密码）
try {
  const u = new URL(location.href);
  if (u.searchParams.has('__df')) {
    u.searchParams.delete('__df');
    history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
  }
} catch { /* ignore */ }

const app = createApp(isPhoneEntry(location.search) ? PhoneView : App);
app.config.globalProperties.$t = t;
app.use(ElementPlus);
app.mount('#app');
