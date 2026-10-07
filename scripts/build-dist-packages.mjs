// build-dist-packages.mjs —— Vivix Human 三端发行包（windows / macos / docker）
// windows / macos：带 server node_modules + web/dist 前端产物，目标机只装 Node ≥22 双击即跑；
// docker：只带源码 + Dockerfile / docker-compose.yml / .dockerignore（容器内两阶段构建）。
// README 进包时摘掉 `![](img/…)` 配图行（发行包不带 img/）；data/ 保持空壳目录。
// 压缩统一走 scripts/zip-utf8.py —— 中文条目必须带 UTF-8 标志位，Windows 解压才不乱码。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const STAGE = path.join(ROOT, '.dist-stage');
const INNER = 'Vivix-Human';

function rm(p) { fs.rmSync(p, { recursive: true, force: true }); }

// 递归拷贝 srcDir → destDir，跳过 skipDirs 里指名的目录（按相对路径段匹配）
function copyTree(srcDir, destDir, skipDirs = []) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const s = path.join(srcDir, e.name);
    const d = path.join(destDir, e.name);
    if (e.isDirectory()) {
      if (skipDirs.includes(e.name)) continue;
      copyTree(s, d, skipDirs);
    } else if (e.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

// README 摘配图行（发行包里没有 img/ 目录，留着死链不好看）
function writeStrippedReadme(dest) {
  const lines = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').split('\n');
  const out = lines.filter((l) => !(l.trimStart().startsWith('![') && l.includes('](img/')));
  fs.writeFileSync(dest, out.join('\n'));
}

function build(kind) {
  const inner = path.join(STAGE, kind, INNER);
  rm(path.join(STAGE, kind));
  fs.mkdirSync(inner, { recursive: true });

  // 公共：服务端 + 根清单
  copyTree(path.join(ROOT, 'server'), path.join(inner, 'server'));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(inner, 'package.json'));
  fs.copyFileSync(path.join(ROOT, 'package-lock.json'), path.join(inner, 'package-lock.json'));
  writeStrippedReadme(path.join(inner, 'README.md'));
  fs.mkdirSync(path.join(inner, 'data')); // 空壳：运行数据目录

  if (kind === 'windows' || kind === 'macos') {
    copyTree(path.join(ROOT, 'node_modules'), path.join(inner, 'node_modules'), ['.github', '.circleci']); // 服务端依赖（express/multer，约 4MB；剥掉上游包带的 CI 配置目录）
    copyTree(path.join(ROOT, 'web'), path.join(inner, 'web'), ['node_modules']); // 源码 + dist 产物
    if (kind === 'windows') fs.copyFileSync(path.join(ROOT, 'start.bat'), path.join(inner, 'start.bat'));
    else fs.copyFileSync(path.join(ROOT, 'start.command'), path.join(inner, 'start.command'));
  } else {
    // docker：源码自带，node_modules 与 dist 都在容器内构建
    copyTree(path.join(ROOT, 'web'), path.join(inner, 'web'), ['node_modules', 'dist']);
    for (const f of ['Dockerfile', 'docker-compose.yml', '.dockerignore']) fs.copyFileSync(path.join(ROOT, f), path.join(inner, f));
  }

  const out = path.join(ROOT, `Vivix-Human-${version}-${kind}.zip`);
  rm(out);
  const script = path.join(ROOT, 'scripts', 'zip-utf8.py');
  // 本机 Git Bash 的 python 是 WindowsApps 空壳——优先走 py 启动器
  let ok = false;
  for (const cmd of [['py', ['-3.10']], ['python', []]]) {
    try { execFileSync(cmd[0], [...cmd[1], script, inner, out], { stdio: 'inherit' }); ok = true; break; }
    catch { /* 换下一个 */ }
  }
  if (!ok) throw new Error('zip-utf8.py 执行失败（找不到可用的 Python）');
  console.log(`[${kind}] ${path.basename(out)} 完成`);
}

for (const kind of (process.argv[2] ? [process.argv[2]] : ['windows', 'macos', 'docker'])) build(kind);
rm(STAGE);
console.log('全部完成，暂存目录已清理');
