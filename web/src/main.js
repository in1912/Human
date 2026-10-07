import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { applyTheme, installGatewayFetchPatch, installErrorHandler } from './boot';
import './style.css';

installGatewayFetchPatch(); // fnOS 网关前缀自适配（非网关部署为 no-op）
applyTheme();              // 深浅主题先落一次，避免首屏闪错色

const app = createApp(App);
installErrorHandler(app);  // 页面级异常兜底（红条 + 复制详情 + chunk 失败自愈）
app.use(router);
router.isReady().then(() => app.mount('#app'));
