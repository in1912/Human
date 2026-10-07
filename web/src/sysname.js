// 系统名称唯一前端来源：响应式共享 ref（模块级单例），localStorage 仅作首屏缓存。
// 服务端 /system-info 为最终依据，应用启动拉取后全站即时生效。
import { ref } from 'vue';

export const sysName = ref(localStorage.getItem('vh_sysname') || 'Vivix Human'); // 兜底默认名：无缓存时的首屏标题
export const sysNameEn = ref(localStorage.getItem('vh_sysname_en') || 'Vivix Human');

// App 启动拉取服务端名称后调用：更新共享状态并同步缓存
export function setSysInfo(name, nameEn) {
  const n = String(name || '').trim();
  const e = String(nameEn || '').trim();
  if (n) { sysName.value = n; localStorage.setItem('vh_sysname', n); }
  if (e) { sysNameEn.value = e; localStorage.setItem('vh_sysname_en', e); }
}
