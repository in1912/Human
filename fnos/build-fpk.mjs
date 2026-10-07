#!/usr/bin/env node
// 装配 Vivix Human 的飞牛 fnOS 包目录（随后由 scripts/build-fpk.py 打成 .fpk）
// 用法：node fnos/build-fpk.mjs [--out <目录>]
//
// 载荷 = server/ + web/dist/<最新时间戳> + 生产 node_modules + package.json(+lock) + README（摘配图行）+ ui/
// 全部从工作区拷贝（Human 无未入库的运行时产物）；装配自检 + 套娃守卫不过直接退出。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FNOS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(FNOS_DIR, '..');
const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(argOf('--out', path.join(ROOT, '..', 'human-fnos-build')));
const PROJ = path.join(OUT, 'vivixhuman');
const APP = path.join(PROJ, 'app');

// 最新前端构建产物（时间戳子目录，同 server/index.js 的 latestDist() 解析规则）
const distRoot = path.join(ROOT, 'web', 'dist');
if (!fs.existsSync(distRoot)) { console.error('未找到 web/dist，先执行 npm run build:web'); process.exit(1); }
const latest = fs.readdirSync(distRoot)
  .filter((f) => fs.statSync(path.join(distRoot, f)).isDirectory() && fs.existsSync(path.join(distRoot, f, 'index.html')))
  .sort().pop();
if (!latest) { console.error('web/dist 下没有含 index.html 的构建产物，先执行 npm run build:web'); process.exit(1); }

fs.rmSync(PROJ, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

// 1) 包骨架：manifest / 图标 / cmd / config / wizard / app-ui（fnos/ 目录即源）
for (const f of ['manifest', 'ICON.PNG', 'ICON_256.PNG', 'cmd', 'config', 'wizard']) {
  fs.cpSync(path.join(FNOS_DIR, f), path.join(PROJ, f), { recursive: true });
}
// 2) UI 入口：fnos/app-ui → app/ui（manifest desktop_uidir=ui）
fs.cpSync(path.join(FNOS_DIR, 'app-ui'), path.join(APP, 'ui'), { recursive: true });

// 3) server/ 全量（种子角色图在 server/dh/seed/，随包分发）
fs.cpSync(path.join(ROOT, 'server'), path.join(APP, 'server'), { recursive: true });

// 4) 根清单 + README（摘掉 ![](img/…) 配图行——载荷里没有 img/）
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(APP, 'package.json'));
fs.copyFileSync(path.join(ROOT, 'package-lock.json'), path.join(APP, 'package-lock.json'));
{
  const lines = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').split('\n');
  fs.writeFileSync(path.join(APP, 'README.md'), lines.filter((l) => !(l.trimStart().startsWith('![') && l.includes('](img/'))).join('\n'));
}

// 5) 前端构建产物：只带最新一份（server/index.js 的 latestDist() 取最新）
fs.cpSync(path.join(distRoot, latest), path.join(APP, 'web', 'dist', latest), { recursive: true });

// 6) 生产依赖：直接拷工作区 node_modules（express/multer，约 4MB，无原生模块）
fs.cpSync(path.join(ROOT, 'node_modules'), path.join(APP, 'node_modules'), {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(path.join(ROOT, 'node_modules'), src);
    return !rel || !['.github', '.circleci'].includes(rel.split(path.sep)[0]);
  },
});

// 版本一致性：manifest（应用中心显示的）必须与 package.json（应用内自称的 v{version}）相同
{
  const mVer = (fs.readFileSync(path.join(FNOS_DIR, 'manifest'), 'utf8').match(/^version\s*=\s*(.+)$/m) || [])[1]?.trim();
  const pVer = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  if (!mVer || mVer !== pVer) {
    console.error(`[fpk] 版本不一致：fnos/manifest 是 ${mVer}，package.json 是 ${pVer}。改齐再打包。`);
    process.exit(1);
  }
  console.log(`[fpk] 版本一致：${mVer}（manifest == package.json）`);
}

// 装配自检：缺一样这包就是废的
const must = [
  ['server/index.js', '服务端入口'],
  ['server/dh/seed', '种子角色图'],
  [`web/dist/${latest}/index.html`, '前端入口'],
  ['node_modules/express/package.json', '生产依赖'],
  ['ui/config', '桌面 UI 入口配置'],
];
const missing = must.filter(([rel]) => !fs.existsSync(path.join(APP, rel)));
if (missing.length) {
  console.error('[fpk] 装配自检失败，缺：' + missing.map(([r, d]) => `${r}（${d}）`).join('、'));
  process.exit(1);
}

// 套娃守卫：载荷里出现 fpk = 把上一版的包打进了这一版。宁可不发也不发这种包。
{
  const found = [];
  const walkFpk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) walkFpk(q);
      else if (e.name.toLowerCase().endsWith('.fpk')) found.push(path.relative(APP, q));
    }
  };
  walkFpk(APP);
  if (found.length) {
    console.error('[fpk] 载荷里混进了 fpk（逐版套娃）：' + found.join('、'));
    process.exit(1);
  }
}

// 目录体积：自己递归算（本机 git-bash 的 du 会因路径问题静默回 0，误导过）
const dirSize = (p) => {
  let total = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const q = path.join(p, e.name);
    total += e.isDirectory() ? dirSize(q) : (() => { try { return fs.statSync(q).size; } catch { return 0; } })();
  }
  return total;
};
console.log(`[fpk] 装配完成: ${PROJ}`);
console.log(`        dist=${latest}  app≈${Math.round(dirSize(APP) / 1048576)}MB`);
console.log('        下一步: py -3.10 scripts/build-fpk.py');
