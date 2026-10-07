// 应用启动共用的环境适配与全局兜底（与业务无关，main.js 调用）
import { rawUrl } from './api';

// 启动时应用主题（深色/浅色）
export function applyTheme() {
  const savedTheme = localStorage.getItem('vh_theme') || 'dark';
  document.documentElement.dataset.theme = savedTheme;
}

// fnOS 网关自适配（仅 /app/.. 前缀下生效）：各视图里散落的裸 fetch('/api/..') 不走 api 模块，
// 统一在这里补网关前缀（只改写以 '/api' 开头的字符串 URL）。非网关部署完全不受影响。
export function installGatewayFetchPatch() {
  const prefix = (location.pathname.match(/^\/app\/[A-Za-z0-9_-]+/) || [''])[0];
  if (!prefix) return '';
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      if (typeof input === 'string' && input.startsWith('/api')) input = prefix + input;
    } catch { /* 任何解析异常都按原请求发出 */ }
    return origFetch(input, init);
  };
  return prefix;
}

// 懒加载 chunk/CSS 瞬时失败自愈：Vite preload 撞上一次网络抖动会抛「Unable to preload CSS」，
// 文件本身可达、之后无复发，但没有兜底时组件挂死、必须手动刷新。带 60 秒防循环标记整页刷新一次：
// 重试成功即无感恢复；刷了还失败（真故障）就让错误照常走红条，绝不无限 reload。
// 组件级异步 import 的失败走 Vue errorHandler（installErrorHandler 里调）、路由级懒加载的
// 失败走 router.onError——两处共用这一个助手。
export function selfHealChunkFail(err) {
  const msg = String((err && err.message) || err || '');
  if (!/preload|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg)) return false;
  const KEY = 'vh_route_reload_ts';
  const last = Number(sessionStorage.getItem(KEY) || 0);
  if (Date.now() - last < 60000) return false;
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* 隐私模式 */ }
  location.reload();
  return true;
}

// 页面级异常兜底：onMounted/setup 里未捕获的异步异常会让整页内容消失。统一接住：
// 右下角红条提示 + 出错位置，点击复制完整堆栈；同一错误 4 秒内去重（Vue 渲染错误重试会触发两次）。
export function installErrorHandler(app) {
  let lastErr = '';
  let lastErrAt = 0;
  app.config.errorHandler = (err) => {
    console.error('[vh]', err);
    try {
      const msg = err && err.message ? err.message : String(err);
      const stack = String((err && err.stack) || '');
      const frame = (stack.split('\n')[1] || '').trim().replace(/^at\s+/, '').slice(0, 160);
      selfHealChunkFail(err); // chunk/CSS 瞬时失败：带防循环标记自动刷新一次
      const now = Date.now();
      if (msg === lastErr && now - lastErrAt < 4000) return;
      lastErr = msg; lastErrAt = now;
      const d = document.createElement('div');
      d.textContent = '页面出了点问题：' + msg + (frame ? `\n(${frame})` : '') + '（点击复制详情）';
      d.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;background:#dc2626;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;max-width:70vw;white-space:pre-line;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.3)';
      d.onclick = () => {
        try { navigator.clipboard.writeText(msg + '\n' + stack + '\npage: ' + location.hash); d.textContent = '已复制，可粘贴给维护者'; } catch { /* 剪贴板不可用就算了 */ }
      };
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 12000);
    } catch { /* 展示失败不影响主流程 */ }
  };
}
