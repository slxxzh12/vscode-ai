import { createApp, h } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import AiRunView from './AiRunView.vue';

const m = location.pathname.match(/^(.*?)\/__run\/([^/]+)$/);
const runId = m ? decodeURIComponent(m[2]) : '';
const apiRoot = m ? `${m[1]}/__api` : '/__api';

createApp({ render: () => h(AiRunView, { runId, apiRoot }) })
  .use(ElementPlus)
  .mount('#app');
