<template>
  <!-- 应用骨架：左侧栏（四个侧栏页）+ 主区（router-view，同一 DhPanel 按路由切 sub）。
       免登录：无顶栏无用户区，打开即用。右下角常驻数字人悬浮按钮（标签随默认角色类型
       显示 AI男友/AI女友/AI萌宠），点开页面右侧的手机模型浮层（DhPhone）。 -->
  <div class="mobile-topbar">
    <button class="hamburger" @click="menuOpen = !menuOpen">☰</button>
    <div class="logo"><span class="dot"></span>{{ sysName }}</div>
  </div>
  <div v-if="menuOpen" class="mobile-mask" @click="menuOpen = false"></div>

  <aside class="sidebar" :class="{ open: menuOpen }">
    <div class="logo"><span class="dot"></span>{{ sysName }}</div>
    <nav class="nav">
      <RouterLink v-for="m in MENU" :key="m.to" :to="m.to" @click="menuOpen = false">
        <span class="material-icons ico">{{ m.icon }}</span>{{ m.label }}
      </RouterLink>
    </nav>
    <div class="sidebar-foot">
      <button class="small" @click="toggleTheme">{{ theme === 'dark' ? '☀ 切浅色' : '🌙 切深色' }}</button>
    </div>
  </aside>

  <main class="main">
    <router-view />
  </main>

  <!-- 右下角数字人悬浮按钮（唯一保留的全局浮层） -->
  <div class="vh-float">
    <button class="vh-fab" :title="dhPhoneTip" @click="toggleDhPhone">
      <span class="material-icons" style="font-size:14px;vertical-align:-2px">smart_toy</span>
      {{ dhLabel() || '数字人' }}
    </button>
  </div>

  <!-- 数字人手机模型浮层：打开即触发实时对话（配了 Vivix Key 时） -->
  <DhPhone v-if="dhState.phoneOpen" />
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from './api';
import { sysName, setSysInfo } from './sysname';
import { dhState, dhRefresh, dhLabel } from './dhState';
import DhPhone from './components/DhPhone.vue';

const MENU = [
  { to: '/main', icon: 'smart_toy', label: '数字人界面' },
  { to: '/chat', icon: 'forum', label: '聊天记录' },
  { to: '/settings', icon: 'settings', label: '设置' },
  { to: '/role', icon: 'face', label: '角色设置' },
];

const menuOpen = ref(false); // 移动端侧栏抽屉

// ---------- 主题（深/浅二档，localStorage 记忆；boot.applyTheme 启动时先落一次） ----------
const theme = ref(localStorage.getItem('vh_theme') || 'dark');
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  localStorage.setItem('vh_theme', theme.value);
  document.documentElement.dataset.theme = theme.value;
}

// ---------- 数字人悬浮按钮 ----------
const dhPhoneTip = computed(() => {
  const p = dhState.personas.find((x) => x.is_default) || dhState.personas[0];
  return p ? `打开${p.name}（${p.type}）` : '打开数字人';
});
function toggleDhPhone() {
  dhState.phoneOpen = !dhState.phoneOpen;
  if (dhState.phoneOpen && !dhState.loaded) dhRefresh();
}

onMounted(async () => {
  // 系统名以服务端为准（/system-info 硬编码 Vivix Human + package.json 版本）
  try {
    const info = await api.get('/system-info');
    setSysInfo(info.name, info.name_en);
  } catch { /* 拉不到就用本地缓存/默认名 */ }
  dhRefresh(); // 悬浮按钮标签要用默认角色类型
});
</script>

<style scoped>
/* 右下角数字人悬浮按钮：常驻、不遮内容 */
.vh-float {
  position: fixed; right: 16px; bottom: 20px; z-index: 1130;
  display: flex; gap: 8px;
}
.vh-fab {
  display: inline-flex; align-items: center; gap: 5px;
  background: rgba(236,100,150,.92); color: #fff;
  border: none; border-radius: 999px;
  padding: 9px 18px; font-size: 13.5px; font-weight: 600;
  cursor: pointer; box-shadow: 0 6px 22px rgba(236,100,150,.35);
}
.vh-fab:hover { background: rgba(236,100,150,1); border: none; color: #fff; }
@media (max-width: 768px) {
  .vh-float { right: 12px; bottom: 14px; }
}
</style>
