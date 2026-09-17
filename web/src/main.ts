import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import App from './App.vue';
import PhoneView from './remote-coder/PhoneView.vue';
import { isPhoneEntry } from './remote-coder/entry';
import './styles.css';
import { t } from './i18n';

const app = createApp(isPhoneEntry(location.search) ? PhoneView : App);
app.config.globalProperties.$t = t;
app.use(ElementPlus);
app.mount('#app');
