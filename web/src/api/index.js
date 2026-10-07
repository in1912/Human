// 飞牛 fnOS 统一网关嵌入：页面挂在 /app/{appname} 前缀下时，API 请求也必须带同款前缀，
// 否则 fetch('/api/..') 会打到 NAS 域名根路径（fnOS 自己的接口）。哈希路由 + vite base './'，
// 其余静态资源天然可迁移，这里补齐 API 这一处。常规部署（根路径）保持 '/api' 不变。
const GATEWAY_PREFIX = (location.pathname.match(/^\/app\/[A-Za-z0-9_-]+/) || [''])[0];
const base = GATEWAY_PREFIX + '/api';
export const GATEWAY_ACTIVE = !!GATEWAY_PREFIX;

// 兼容老内核 webview（不支持 AbortSignal.timeout 的浏览器）：
// 不打补丁的话该设备上全站请求直接抛 TypeError，全局补丁 + 本模块被所有视图 import 一并覆盖。
if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = (ms) => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    return ctrl.signal;
  };
}

// 本应用免登录（服务端给每个请求注入内置本地账号），不存在「会话过期」；
// 万一真收到 401，只报错不跳转——没有登录页可去。
function handle401() {
  throw new Error('服务端拒绝了这次请求（401）。本应用免登录，请刷新页面重试；若持续出现，检查应用是否正常启动');
}

// 给不走 api 模块的裸 '/api/..' 调用（XHR 上传、<img> 直链等）用：补网关前缀。
// 非 '/api' 开头（跨机绝对地址等）原样返回。
export function rawUrl(url) {
  if (!url.startsWith('/api')) return url;
  return GATEWAY_PREFIX + url;
}

// 非 API 路径补网关前缀：常规部署前缀为空原样返回，fnOS 网关下补成 /app/{appname}/…。
export function prefixUrl(p) {
  return GATEWAY_PREFIX + p;
}

// 二进制/附件通道的网关假 200 守卫：网关代答（HTTP 200 + text/plain「invalid token」）会被
// res.ok 直判当成功。合法下载响应必带 attachment 头，无头的 text/plain|html 才是代答。
async function rejectGatewayText(res) {
  if (!res.ok) return; // 非 2xx 由调用方按各自语义报错
  const cd = res.headers.get('content-disposition') || '';
  if (/\battachment\b/i.test(cd)) return;
  const ct = res.headers.get('content-type') || '';
  if (!/^text\/(plain|html)/i.test(ct)) return;
  const text = await res.text();
  const snippet = text.slice(0, 120).replace(/\s+/g, ' ');
  throw new Error(
    snippet.includes('invalid token')
      ? 'NAS 会话已失效（网关拦截了该请求）：请打开 NAS 网页重新登录后刷新本页，或从飞牛桌面重新进入应用'
      : `响应被网关代答（${snippet || '空响应'}），请重试或重新进入应用`
  );
}

// 部分中转（花生壳型 HTTP 映射）会掐 PATCH 方法的连接（GET/POST/PUT/DELETE 均可达、PATCH 必断）：
// 所有 PATCH 实际改发 PUT + 还原头，服务端中间件在路由前还原为 PATCH，路由零改动。
// 幂等方法网络层失败自动重试一次（中转杀连接/复用死套接字时换新连接可达）；
// POST 不重试——新建类请求重发可能产生重复数据。
const NET_RETRY = new Set(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']);

// timeoutMs：常规接口 180s 够用；可能含模型冷启动的长调用传更长（见 api.postSlow）
async function request(method, url, body, retried = false, timeoutMs = 180000) {
  const opts = { method, headers: {} };
  if (method === 'PATCH') {
    opts.method = 'PUT';
    opts.headers['X-HTTP-Method'] = 'PATCH';
  }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  // PATCH 还原双通道：X-HTTP-Method 头之外再追加 ?_method=PATCH 查询参数——
  // 网关可能剥自定义头，查询参数任何网关都不动。
  let full = base + url;
  if (method === 'PATCH') full += (full.includes('?') ? '&' : '?') + '_method=PATCH';
  let res;
  try {
    res = await fetch(full, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (!retried && NET_RETRY.has(method) && e && e.name !== 'AbortError') {
      await new Promise((r) => setTimeout(r, 500));
      return request(method, url, body, true, timeoutMs);
    }
    throw new Error('网络连接失败，请重试（若反复失败请检查网络或稍后再试）');
  }
  if (res.status === 401) handle401();
  // 先读文本再解析：200 但非 JSON 的响应（网关用自己的文本/错误页顶替业务响应）直接报错，
  // 不静默吞成 {} 让页面拿 undefined 崩。
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 200).replace(/\s+/g, ' ');
    // 反代/网关超时或出错时回的是它自己的 HTML 错误页——认出来直接说清「请求没到应用」。
    const isGatewayPage = /cloudflare|cf-error|Attention Required|Error 5\d\d/i.test(text);
    throw new Error(
      isGatewayPage
        ? `请求被网关掐断了（HTTP ${res.status}）——它没能到达本应用，页面里这段 HTML 是网关自己的错误页。最常见的原因是这个请求跑得太久（网关等待源站有上限）。`
        : `接口响应异常（HTTP ${res.status}，非 JSON：${snippet}）`
    );
  }
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  // 长耗时 POST（LLM 文字回复可能含模型冷启动）：超时放宽到 5 分钟
  postSlow: (url, body) => request('POST', url, body ?? {}, false, 300000),
  put: (url, body) => request('PUT', url, body ?? {}),
  patch: (url, body) => request('PATCH', url, body ?? {}),
  del: (url) => request('DELETE', url),
  download,
  blob: postBlob,
  upload,
};

// multipart 上传（fields 普通字段 + files: [{name, file}] 文件字段）。
// FormData 由浏览器自动设 Content-Type/boundary，这里不能再手工指定 JSON 头。
async function upload(url, fields = {}, files = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== '') fd.append(k, v);
  }
  for (const f of files) fd.append(f.name, f.file, f.file.name);
  const res = await fetch(base + url, {
    method: 'POST',
    body: fd,
    signal: AbortSignal.timeout(300000),
  });
  if (res.status === 401) handle401();
  await rejectGatewayText(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `上传失败 (${res.status})`);
  return data;
}

// 取二进制（参考图等）。
async function postBlob(url, body) {
  const res = await fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(300000),
  });
  if (res.status === 401) handle401();
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `请求失败 (${res.status})`);
  }
  await rejectGatewayText(res);
  return res.blob();
}

// 下载文件（fetch 取 blob 后触发浏览器保存）。filename 缺省时从 Content-Disposition 解析。
async function download(url, filename) {
  const res = await fetch(base + url);
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `下载失败 (${res.status})`);
  }
  await rejectGatewayText(res);
  if (!filename) {
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="([^"]+)"/);
    if (m) filename = decodeURIComponent(m[1]);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename || 'download';
  a.click();
  URL.revokeObjectURL(objectUrl);
}
