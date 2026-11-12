import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import AiRunView from './AiRunView.vue';

createApp(AiRunView).use(ElementPlus).mount('#app');
