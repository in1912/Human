// Vivix Human — 服务端入口（Express + node:sqlite，免登录）
// 中间件顺序（重要）：
//   ① DH 参考图令牌网关（Vivix 服务器建会话时公网取图，无登录态，只认 ?it= 短时签名令牌）
//   ② PATCH 还原（前端 PUT + X-HTTP-Method 头，应对掐 PATCH 方法的中转）
//   ③ express.json
//   ④ 本地用户注入（免登录：所有 /api 一律 req.user = ensureLocalUser()）
//   ⑤ 路由（/api/dh + /api/llm + /api/system-info + /api/health）
//   ⑥ 前端静态产物（web/dist/<时间戳> 取最新）+ SPA 回退
//   ⑦ 飞牛 fnOS 统一网关（FNOS_PREFIX + FNOS_APP_SOCK unix socket）
'use strict';
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { name: APP_NAME, version: APP_VERSION } = require('../package.json');
const { getTenantDb, ensureLocalUser } = require('./db');
const dhService = require('./services/dhService');
const dhRoutes = require('./routes/dhRoutes');
const aiService = require('./services/aiService');

const app = express();
app.disable('x-powered-by');

// ① DH 参考图公网直取：URL 带 dhService 签发的短时令牌（?it=，只绑这一张图、2 小时有效）。
// 只放行 GET /dh/images/:id/raw 且令牌合法这一条（令牌里的 uid 反查租户库注入 req.tdb）。
// 伪造/过期令牌一律 403。
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' && /^\/dh\/images\/\d+\/raw$/.test(req.path) && typeof req.query.it === 'string') {
    const imgId = Number(req.path.split('/')[3]);
    const hit = dhService.resolveImageToken(req.query.it, imgId);
    if (!hit) return res.status(403).json({ error: '图片令牌无效或已过期' });
    req.tdb = getTenantDb(hit.uid);
    return next();
  }
  next();
});

// ② 部分中转（花生壳型）会掐 PATCH 方法：前端改发 PUT + X-HTTP-Method: PATCH，这里还原。
app.use((req, res, next) => {
  if (req.method === 'PUT' && (req.headers['x-http-method'] === 'PATCH' || String(req.query._method || '').toUpperCase() === 'PATCH')) req.method = 'PATCH';
  next();
});
// 同类中转声明 keep-alive 却杀连接：显式 Connection: close 让每个请求走全新连接。
app.use((req, res, next) => {
  res.setHeader('Connection', 'close');
  next();
});

app.use(express.json({ limit: '12mb' }));

// ④ 免登录实现点：所有 /api 一律注入内置本地账号（管理员）+ 租户库。
app.use('/api', (req, res, next) => {
  req.user = ensureLocalUser();
  if (!req.tdb) req.tdb = getTenantDb(req.user.id);
  next();
});

// ---------- 路由 ----------
app.use('/api', dhRoutes); // 路由内部自带 /dh 前缀

// 文字对话模型（LLM）配置：api_key 只写不回读
app.get('/api/llm/config', (req, res) => res.json(aiService.publicLlmConfig(req.tdb)));
app.put('/api/llm/config', (req, res) => {
  const patch = req.body || {};
  if (patch.base_url !== undefined && !/^https?:\/\/.+/i.test(String(patch.base_url || '').trim())) {
    return res.status(400).json({ error: 'Base 地址必须以 http:// 或 https:// 开头' });
  }
  aiService.saveLlmConfig(req.tdb, patch);
  res.json({ ok: true, ...aiService.publicLlmConfig(req.tdb) });
});

app.get('/api/system-info', (req, res) => {
  res.json({
    name: 'Vivix Human',
    name_en: 'Vivix Human',
    version: `v${APP_VERSION}`,
    node: process.version,
  });
});
app.get('/api/health', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---------- 前端静态产物 ----------
// web/dist 下可能累积多个时间戳子目录，每次请求解析最新（重建前端后无需重启服务）。
const webDistRoot = path.join(__dirname, '..', 'web', 'dist');
function latestDist() {
  try {
    const subs = fs.readdirSync(webDistRoot)
      .filter((f) => fs.statSync(path.join(webDistRoot, f)).isDirectory() && fs.existsSync(path.join(webDistRoot, f, 'index.html')))
      .sort();
    if (subs.length) return path.join(webDistRoot, subs[subs.length - 1]);
  } catch { /* dist 目录不存在 */ }
  return null;
}
let webDist = latestDist();
if (webDist) {
  let staticDir = '', staticHandler = null;
  const staticFor = (dir) => {
    if (dir !== staticDir) { staticDir = dir; staticHandler = express.static(dir); }
    return staticHandler;
  };
  // 强制不缓存：避免浏览器加载旧版前端（每次构建产物 hash 变化）
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    next();
  });
  app.use((req, res, next) => {
    const dir = latestDist() || webDist;
    staticFor(dir)(req, res, next);
  });
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(latestDist() || webDist, 'index.html')));
  console.log('[web] 前端静态资源已加载:', webDist, '（后续构建自动生效）');
} else {
  console.log('[web] 未找到前端构建产物，仅 API 模式（请先执行 npm run build:web）');
}

const PORT = process.env.PORT || process.env.TRIM_SERVICE_PORT || 3000;

// ---------- 飞牛 fnOS 统一网关：/app/{appname} 前缀 + Unix Socket ----------
// fnOS 桌面入口的请求经 NAS 登录态校验后转发到应用 socket；这里把整套 app 挂到前缀下复用全部路由与静态资源。
const FNOS_PREFIX = process.env.FNOS_PREFIX || '';
const FNOS_APP_SOCK = process.env.FNOS_APP_SOCK || '';
if (FNOS_PREFIX && FNOS_APP_SOCK) {
  const gatewayApp = express();
  gatewayApp.use(FNOS_PREFIX, app);
  try { fs.unlinkSync(FNOS_APP_SOCK); } catch { /* 首次启动无残留 socket */ }
  const gwSrv = http.createServer(gatewayApp);
  gwSrv.listen(FNOS_APP_SOCK, () => {
    try { fs.chmodSync(FNOS_APP_SOCK, 0o666); } catch { /* Windows/权限差异，尽力而为 */ }
    console.log(`[fnos] 统一网关已监听: ${FNOS_APP_SOCK}（前缀 ${FNOS_PREFIX}）`);
  });
  gwSrv.on('error', (e) => console.warn('[fnos] 网关 Socket 监听失败（不影响 TCP 端口服务）:', e.message));
}

app.listen(Number(PORT), () => {
  console.log(`[server] ${APP_NAME} v${APP_VERSION} 已启动: http://localhost:${PORT}`);
});

process.on('uncaughtException', (e) => console.error('[server] uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('[server] unhandledRejection:', e));
