import { createRouter, createWebHashHistory } from 'vue-router';
import { selfHealChunkFail } from '../boot';

// 哈希路由（可在 fnOS 网关 /app/{appname} 前缀与任意子路径下迁移部署）。
// 侧栏四页共用同一 DhPanel 组件（sub prop 由各路由写死）——vue-router 对同一组件的
// 导航会复用组件实例：切页不重挂载，进行中的实时会话与表单状态不丢。
const DhPanel = () => import('../components/DhPanel.vue');

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/main' },
    { path: '/main', component: DhPanel, props: { sub: 'main' } },
    { path: '/chat', component: DhPanel, props: { sub: 'chat' } },
    { path: '/settings', component: DhPanel, props: { sub: 'settings' } },
    { path: '/role', component: DhPanel, props: { sub: 'role' } },
    { path: '/:pathMatch(.*)*', redirect: '/main' },
  ],
});

// 路由级懒加载失败（网络抖动/Vite preload 瞬时失败）自愈：带防循环标记整页刷新一次
router.onError((err) => { selfHealChunkFail(err); });

export default router;
